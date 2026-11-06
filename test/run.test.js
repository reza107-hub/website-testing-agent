import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstructions } from "../scripts/instructions.js";
import {
  addRepairs, buildAbortRun, buildPlan, cleanupRun, loadRepairs, markSignInFailed, preflight, runQueue, saveState,
} from "../scripts/run.js";
import { validateIssue } from "../scripts/report.js";
import { mayRunPaymentStep, stripeKeyMode } from "../scripts/guards.js";

const sample = (extraSetup = "") => `## Setup
${extraSetup}
## Targets
- local: http://local.test
- beta: https://beta.test

## Accounts
- recipe: email=a@x.test | password=1 | niche=recipe | plan=pro
- tech: email=b@x.test | password=2 | niche=tech | plan=pro
- free: email=c@x.test | password=3 | plan=free
- diy: email=d@x.test | password=4 | niche=diy | plan=pro

## Feature: search
steps:
- Open /search
expect:
- e1

## Feature: profile
steps:
- Open /profile
expect:
- e2
`;

const parsed = (extra) => parseInstructions(sample(extra));
const plan = (p, request, opts) => {
  const r = buildPlan(p, request, opts);
  assert.equal(r.status, "ok", JSON.stringify(r));
  return r.plan;
};

test("max_parallel defaults to 3, is read, and a bad value is a problem", () => {
  assert.equal(parsed().setup.max_parallel, 3);
  assert.equal(parsed("max_parallel: 5").setup.max_parallel, 5);
  assert.equal(parsed("max_parallel: 0").problems[0].key, "max_parallel");
});

// the session limit
test("more items than the cap all complete, never exceeding the cap", async () => {
  let running = 0;
  let peak = 0;
  const items = Array.from({ length: 8 }, (_, i) => i);
  const results = await runQueue(items, 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15 - n));
    running--;
    return n * 2;
  });
  assert.deepEqual(results, items.map((n) => n * 2));
  assert.equal(peak, 3);
});

// 3.1 missing and unknown: nothing is planned, nothing is opened
test("no target and no accounts: status missing, no plan, nothing to open", () => {
  const r = buildPlan(parsed(), "search", {});
  assert.equal(r.status, "missing");
  assert.deepEqual(r.missing, ["target", "accounts"]);
  assert.equal(r.plan, undefined);
  assert.deepEqual(r.declared.targets.map((t) => t.name), ["local", "beta"]);
  assert.deepEqual(r.declared.accounts.find((a) => a.name === "free"), { name: "free", labels: { plan: "free" } });
});

test("a target without accounts, and accounts without a target, each say what is missing", () => {
  assert.deepEqual(buildPlan(parsed(), "search", { target: "beta" }).missing, ["accounts"]);
  assert.deepEqual(buildPlan(parsed(), "search", { accounts: ["recipe"] }).missing, ["target"]);
  assert.deepEqual(buildPlan(parsed(), undefined, { target: "beta", accounts: ["recipe"] }).missing, ["feature"]);
});

test("only one target declared: the target is still asked for, never assumed", () => {
  const one = parseInstructions(sample().replace("- beta: https://beta.test\n", ""));
  const r = buildPlan(one, "search", { accounts: ["recipe"] });
  assert.equal(r.status, "missing");
  assert.deepEqual(r.missing, ["target"]);
  assert.deepEqual(r.declared.targets.map((t) => t.name), ["local"]);
});

test("an undeclared target, account or feature stops the run and lists what is declared", () => {
  const r = buildPlan(parsed(), "nope", { target: "prod", accounts: ["recipe", "ghost"] });
  assert.equal(r.status, "unknown");
  assert.deepEqual(r.unknown, { feature: "nope", target: "prod", accounts: ["ghost"] });
  assert.deepEqual(r.declared.features, ["search", "profile"]);
  assert.match(r.message, /not declared/i);
  assert.equal(r.plan, undefined);
});

test("names match case-insensitively and the declared spelling is used", () => {
  const p = plan(parsed(), "SEARCH", { target: "BETA", accounts: ["Recipe"] });
  assert.equal(p.request.target, "beta");
  assert.deepEqual(p.request.accounts, ["recipe"]);
  assert.equal(p.target.url, "https://beta.test");
});

// 3.3
test("all means every feature on the requested accounts and the requested target, headless", () => {
  const p = plan(parsed(), "all", { target: "beta", accounts: ["recipe", "free"], runId: "r1" });
  assert.equal(p.headed, false);
  assert.equal(p.maxParallel, 3);
  assert.deepEqual(p.sessions.map((s) => s.account), ["recipe", "free"]);
  assert.deepEqual(p.features.map((f) => f.name), ["search", "profile"]);
  for (const s of p.sessions) {
    assert.equal(s.headed, false);
    assert.deepEqual(s.features, ["search", "profile"]);
    assert.match(s.name, /^str1-/);
  }
  assert.equal(new Set(p.sessions.map((s) => s.name)).size, 2);
  assert.deepEqual(p.sessions[1].labels, { plan: "free" });
});

test("accounts that are not in the request never run, even though they are declared", () => {
  const p = plan(parsed(), "all", { target: "local", accounts: ["tech"] });
  assert.deepEqual(p.sessions.map((s) => s.account), ["tech"]);
});

test("a repeated account is run once", () => {
  const p = plan(parsed(), "search", { target: "local", accounts: ["tech", "TECH", "tech"] });
  assert.equal(p.sessions.length, 1);
});

test("single feature: visible window, one account at a time", () => {
  const p = plan(parsed(), "search", { target: "local", accounts: ["recipe", "free"], runId: "r2" });
  assert.equal(p.headed, true);
  assert.equal(p.maxParallel, 1);
  assert.ok(p.sessions.every((s) => s.headed));
  assert.deepEqual(p.features.map((f) => f.name), ["search"]);
});

test("attach mode shares one browser: one account at a time, state cleared first", () => {
  const text = `## Setup\nbrowser: brave\nbrowser_mode: attach\n${sample().replace("## Setup\n", "")}`;
  const p = plan(parseInstructions(text), "all", { target: "local", accounts: ["recipe", "tech"], runId: "r3" });
  assert.equal(p.maxParallel, 1);
  assert.ok(p.sessions.every((s) => s.clearStateFirst === true));
  const own = plan(parsed(), "all", { target: "local", accounts: ["recipe", "tech"], runId: "r4" });
  assert.ok(own.sessions.every((s) => s.clearStateFirst === false));
});

// 3.2 features appear once
test("the plan lists each feature once; with 20 features and 6 accounts it is much smaller than the v1 shape", (t) => {
  const features = Array.from({ length: 20 }, (_, i) => `\n## Feature: feature-${i}\nsteps:\n${Array.from({ length: 8 }, (_, j) => `- Open /page-${i} and do step number ${j} carefully`).join("\n")}\nexpect:\n- Page ${i} looks right\n- Nothing is broken on page ${i}\nchecks:\n- no console errors\n`).join("");
  const accounts = Array.from({ length: 6 }, (_, i) => `- acct${i}: email=a${i}@x.test | password=p${i} | niche=n${i} | plan=pro`).join("\n");
  const p = parseInstructions(`## Targets\n- local: http://local.test\n\n## Accounts\n${accounts}\n${features}`);
  const built = plan(p, "all", { target: "local", accounts: p.accounts ? Object.keys(p.accounts) : [], runId: "big" });
  const v2 = JSON.stringify(built).length;
  // The v1 shape repeated every feature's steps inside every account's session.
  const v1 = JSON.stringify({ ...built, features: undefined, sessions: built.sessions.map((s) => ({ ...s, features: built.features.map((f) => ({ ...f, target: "local", url: built.target.url })) })) }).length;
  t.diagnostic(`plan size for 20 features and 6 accounts: v1 shape ${v1} bytes, v2 shape ${v2} bytes (${Math.round((v2 / v1) * 100)}%)`);
  assert.ok(v2 < v1 / 3, `v2 ${v2} should be well under a third of v1 ${v1}`);
  assert.equal(built.features.length, 20);
  assert.equal(built.sessions.length, 6);
  assert.ok(built.sessions.every((s) => s.features.length === 20 && typeof s.features[0] === "string"));
  assert.equal(JSON.stringify(built).split(built.target.url).length - 1, 1, "the target address appears once");
});

// 3.4
test("the words, extras, target, accounts and repairs stay in the plan for the report", () => {
  const repairs = [{ what: "Added a web scheme to a target address", old: "- a: x.test", new: "- a: https://x.test" }];
  const p = plan(parsed(), "search", {
    target: "beta", accounts: ["recipe", "free"], words: "on beta using the recipe and the free account",
    extras: ["the pricing note is shown"], repairs,
  });
  assert.deepEqual(p.request, {
    feature: "search", words: "on beta using the recipe and the free account", target: "beta",
    accounts: ["recipe", "free"], extras: ["the pricing note is shown"],
  });
  assert.deepEqual(p.repairs, repairs);
});

test("repairs wait in the temp folder until the next plan", () => {
  const host = mkdtempSync(join(tmpdir(), "st-rep-"));
  assert.deepEqual(loadRepairs(host), []);
  addRepairs(host, [{ what: "a", old: "1", new: "2" }]);
  addRepairs(host, [{ what: "b", old: "3", new: "4" }]);
  assert.deepEqual(loadRepairs(host).map((r) => r.what), ["a", "b"]);
});

// preflight
const up = async () => 200;

test("an unreachable target skips every feature, and the sessions stay listed for cleanup", async () => {
  const p = plan(parsed(), "all", { target: "beta", accounts: ["recipe", "free"], runId: "r5" });
  const pre = await preflight(p, { fetchStatus: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(pre.ok, true);
  assert.equal(pre.plan.sessions.length, 2, "kept so cleanup can close them");
  assert.ok(pre.plan.sessions.every((s) => s.features.length === 0 && /did not respond/.test(s.skipped)));
  assert.equal(pre.plan.notRun.length, 4);
  assert.match(pre.plan.notRun[0].reason, /target "beta" did not respond/);
});

test("a target that answers with a server error counts as down", async () => {
  const p = plan(parsed(), "profile", { target: "local", accounts: ["recipe"] });
  const pre = await preflight(p, { fetchStatus: async () => 503 });
  assert.equal(pre.plan.notRun.length, 1);
});

test("a target that answers (even with a 404) lets the run go on", async () => {
  const p = plan(parsed(), "profile", { target: "local", accounts: ["recipe"] });
  const pre = await preflight(p, { fetchStatus: async () => 404 });
  assert.equal(pre.plan.notRun.length, 0);
  assert.deepEqual(pre.plan.sessions[0].features, ["profile"]);
});

test("a missing browser stops the whole run before the target check", async () => {
  const p = plan(parsed("browser: chrome"), "all", { target: "local", accounts: ["recipe"] });
  let fetched = false;
  const pre = await preflight(p, { fetchStatus: async () => { fetched = true; return 200; }, browserDeps: { isInstalled: () => false } });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /not installed/);
  assert.equal(fetched, false);
});

test("desktop control without permission stops the whole run", async () => {
  const p = plan(parsed("desktop_control: on"), "all", { target: "local", accounts: ["recipe"] });
  const pre = await preflight(p, {
    fetchStatus: up,
    desktopRun: () => ({ status: 0, stdout: JSON.stringify({ data: { permissions: { accessibility: { state: "denied" } } } }) }),
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /accessibility permission/);
});

test("a failed sign-in skips only that account, keeps its session for cleanup, and records a valid issue", () => {
  const p = plan(parsed(), "all", { target: "beta", accounts: ["recipe", "tech", "free"], runId: "r6" });
  markSignInFailed(p, "tech", { reason: "wrong password", screenshot: ".testing-agent/tmp/screens/tech.png" });
  assert.deepEqual(p.sessions.map((s) => s.account), ["recipe", "tech", "free"]);
  assert.deepEqual(p.sessions.map((s) => s.features.length), [2, 0, 2]);
  assert.match(p.sessions[1].skipped, /sign-in failed for account "tech"/);
  assert.equal(p.notRun.length, 2);
  assert.equal(p.issues.length, 1);
  assert.equal(p.issues[0].target, "beta");
  assert.deepEqual(validateIssue(p.issues[0]), []);
  markSignInFailed(p, "tech");
  assert.equal(p.issues.length, 2, "a second call adds an issue but does not skip twice");
  assert.equal(p.notRun.length, 2);
});

test("cleanup closes every listed session, including a skipped one, and removes the temp folder twice safely", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-clean-"));
  const p = plan(parsed(), "all", { target: "beta", accounts: ["recipe", "tech"], runId: "r7" });
  markSignInFailed(p, "tech", { screenshot: "x.png" });
  saveState(host, p);
  writeFileSync(join(host, ".testing-agent", "tmp", "screens", "x.png"), "x");
  const closed = [];
  const first = await cleanupRun(host, { close: (n) => closed.push(n) });
  assert.equal(first.closed.length, 2, "the browser opened for the failed sign-in is closed too");
  assert.deepEqual(closed.sort(), p.sessions.map((s) => s.name).sort());
  assert.equal(existsSync(join(host, ".testing-agent", "tmp")), false);
  const second = await cleanupRun(host, { close: () => assert.fail("should not close anything") });
  assert.deepEqual(second.closed, []);
});

test("cleanup after an aborted run (no report built) still leaves nothing behind", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-abort-"));
  saveState(host, plan(parsed(), "search", { target: "local", accounts: ["recipe"], runId: "r8" }));
  mkdirSync(join(host, ".testing-agent", "tmp", "extra"), { recursive: true });
  await cleanupRun(host, { close: () => {} });
  assert.equal(existsSync(join(host, ".testing-agent", "tmp")), false);
});

// 3.5
test("an abort run is a failing run with the reason, and no sessions", () => {
  const run = buildAbortRun("the target was not given and nobody could answer", "stepgen");
  assert.equal(run.aborted, true);
  assert.deepEqual(run.sessions, []);
  assert.equal(run.notRun[0].reason, "the target was not given and nobody could answer");
  assert.equal(run.request.words, "stepgen");
});

// the Stripe guard
test("stripe guard: only a test-mode key allows payment steps", () => {
  assert.equal(stripeKeyMode("pk_test_51ABCdef123"), "test");
  assert.equal(stripeKeyMode("pk_live_51ABCdef123"), "live");
  for (const bad of ["", undefined, null, "sk_test_abc", "pk_test_", "pk_test_a b", "PK_TEST_abc"]) {
    assert.equal(stripeKeyMode(bad), "unknown");
  }
  assert.equal(mayRunPaymentStep("pk_test_51ABC"), true);
  assert.equal(mayRunPaymentStep("pk_live_51ABC"), false);
  assert.equal(mayRunPaymentStep(undefined), false);
});

// label selectors: the code decides, so an unattended run cannot slip past an ambiguity
test("an account can be selected by a label; exactly one match is used", () => {
  const p = plan(parsed(), "search", { target: "local", accounts: ["plan=free", "niche=TECH"] });
  assert.deepEqual(p.request.accounts, ["free", "tech"]);
  assert.deepEqual(p.sessions.map((s) => s.account), ["free", "tech"]);
});

test("a label that fits more than one account is ambiguous, lists the candidates and plans nothing", () => {
  const r = buildPlan(parsed(), "search", { target: "local", accounts: ["plan=pro"] });
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.ambiguous, [{ selector: "plan=pro", candidates: ["recipe", "tech", "diy"] }]);
  assert.match(r.message, /plan=pro matches recipe, tech, diy/);
  assert.deepEqual(r.declared.accounts.map((a) => a.name), ["recipe", "tech", "free", "diy"]);
  assert.equal(r.plan, undefined);
});

test("a label that fits no account is not declared", () => {
  const r = buildPlan(parsed(), "search", { target: "local", accounts: ["plan=enterprise"] });
  assert.equal(r.status, "unknown");
  assert.deepEqual(r.unknown, { accounts: ["plan=enterprise"] });
});

test("a name and a label can be mixed; an unknown one is reported before an ambiguous one", () => {
  assert.deepEqual(plan(parsed(), "search", { target: "local", accounts: ["recipe", "plan=free"] }).request.accounts, ["recipe", "free"]);
  assert.equal(buildPlan(parsed(), "search", { target: "local", accounts: ["plan=pro", "ghost"] }).status, "unknown");
});

test("a named account that is also picked by its label runs once", () => {
  assert.deepEqual(plan(parsed(), "search", { target: "local", accounts: ["free", "plan=free"] }).request.accounts, ["free"]);
});
