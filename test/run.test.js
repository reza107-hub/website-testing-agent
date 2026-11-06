import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstructions } from "../scripts/instructions.js";
import { buildPlan, cleanupRun, markSignInFailed, preflight, runQueue, saveState } from "../scripts/run.js";
import { validateIssue } from "../scripts/report.js";
import { mayRunPaymentStep, stripeKeyMode } from "../scripts/guards.js";

const sample = (extraSetup = "") => `## Setup
${extraSetup}
## Targets
- local: http://local.test
- live: http://live.test

## Accounts
- recipe: email=a@x.test | password=1
- tech: email=b@x.test | password=2
- diy: email=c@x.test | password=3
- fitness: email=d@x.test | password=4

## Feature: search
target: local
steps:
- s1
expect:
- e1

## Feature: profile
target: live
steps:
- s2
expect:
- e2
`;

const up = async () => 200;

test("max_parallel is parsed, defaults to 3, and rejects bad values", () => {
  assert.equal(parseInstructions(sample()).setup.max_parallel, 3);
  assert.equal(parseInstructions(sample("max_parallel: 5")).setup.max_parallel, 5);
  assert.ok(parseInstructions(sample("max_parallel: 0")).errors.some((e) => /max_parallel/.test(e)));
});

// 5.4
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

// 5.2, 5.3
test("all: one headless session per account, in parallel up to the cap, features in order", () => {
  const plan = buildPlan(parseInstructions(sample()), "all", { runId: "r1" });
  assert.equal(plan.headed, false);
  assert.equal(plan.maxParallel, 3);
  assert.deepEqual(plan.sessions.map((s) => s.account), ["recipe", "tech", "diy", "fitness"]);
  assert.equal(new Set(plan.sessions.map((s) => s.name)).size, 4);
  for (const s of plan.sessions) {
    assert.equal(s.headed, false);
    assert.deepEqual(s.features.map((f) => f.name), ["search", "profile"]);
    assert.match(s.name, /^str1-/);
  }
});

test("single feature: visible window, one account at a time", () => {
  const plan = buildPlan(parseInstructions(sample()), "search", { runId: "r2" });
  assert.equal(plan.headed, true);
  assert.equal(plan.maxParallel, 1);
  assert.ok(plan.sessions.every((s) => s.headed && s.features.length === 1));
});

test("an unmatched feature name returns an error and the declared names", () => {
  const plan = buildPlan(parseInstructions(sample()), "nope");
  assert.ok(plan.error);
  assert.deepEqual(plan.declared, ["search", "profile"]);
});

test("a feature limited to some accounts only appears in those sessions", () => {
  const text = sample().replace("target: live\n", "target: live\naccounts: tech, diy\n");
  const plan = buildPlan(parseInstructions(text), "all", { runId: "r3" });
  const names = (a) => plan.sessions.find((s) => s.account === a).features.map((f) => f.name);
  assert.deepEqual(names("tech"), ["search", "profile"]);
  assert.deepEqual(names("recipe"), ["search"]);
});

// 5.1
test("an unreachable target skips only the features that use it", async () => {
  const plan = buildPlan(parseInstructions(sample()), "all", { runId: "r4" });
  const fetchStatus = async (url) => {
    if (url.includes("live.test")) throw new Error("ECONNREFUSED");
    return 200;
  };
  const pre = await preflight(plan, { fetchStatus });
  assert.equal(pre.ok, true);
  assert.ok(pre.plan.sessions.every((s) => s.features.every((f) => f.target === "local")));
  assert.equal(pre.plan.sessions.length, 4);
  assert.equal(pre.plan.notRun.length, 4);
  assert.match(pre.plan.notRun[0].reason, /target "live" did not respond/);
});

test("a target that answers with a server error counts as down", async () => {
  const plan = buildPlan(parseInstructions(sample()), "profile", { runId: "r5" });
  const pre = await preflight(plan, { fetchStatus: async () => 503 });
  assert.equal(pre.plan.sessions.length, 0);
  assert.equal(pre.plan.notRun.length, 4);
});

test("a missing browser stops the whole run before any target check", async () => {
  const plan = buildPlan(parseInstructions(sample("browser: chrome")), "all", { runId: "r6" });
  let fetched = false;
  const pre = await preflight(plan, {
    fetchStatus: async () => { fetched = true; return 200; },
    browserDeps: { isInstalled: () => false },
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /not installed/);
  assert.equal(fetched, false);
});

test("desktop control without permission stops the whole run", async () => {
  const plan = buildPlan(parseInstructions(sample("desktop_control: on")), "all", { runId: "r7" });
  const pre = await preflight(plan, {
    fetchStatus: up,
    desktopRun: () => ({ status: 0, stdout: JSON.stringify({ data: { permissions: { accessibility: { state: "denied" } } } }) }),
  });
  assert.equal(pre.ok, false);
  assert.match(pre.error, /accessibility permission/);
});

test("a failed sign-in skips only that account and records a valid issue", () => {
  const plan = buildPlan(parseInstructions(sample()), "all", { runId: "r8" });
  markSignInFailed(plan, "tech", { reason: "wrong password", screenshot: ".testing-agent/tmp/screens/tech.png" });
  assert.deepEqual(plan.sessions.map((s) => s.account), ["recipe", "diy", "fitness"]);
  assert.equal(plan.notRun.length, 2);
  assert.match(plan.notRun[0].reason, /sign-in failed for account "tech"/);
  assert.equal(plan.issues.length, 1);
  assert.deepEqual(validateIssue(plan.issues[0]), []);
});

// 5.5
test("cleanup closes only this run's sessions and removes the temp folder, twice safely", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-clean-"));
  const plan = buildPlan(parseInstructions(sample()), "all", { runId: "r9" });
  saveState(host, plan);
  writeFileSync(join(host, ".testing-agent", "tmp", "screens", "x.png"), "x");
  const closed = [];
  const first = await cleanupRun(host, { close: (n) => closed.push(n) });
  assert.equal(first.closed.length, 4);
  assert.deepEqual(closed.sort(), plan.sessions.map((s) => s.name).sort());
  assert.equal(existsSync(join(host, ".testing-agent", "tmp")), false);
  const second = await cleanupRun(host, { close: () => assert.fail("should not close anything") });
  assert.deepEqual(second.closed, []);
});

test("cleanup after an aborted run (no report built) still leaves nothing behind", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-abort-"));
  saveState(host, buildPlan(parseInstructions(sample()), "search", { runId: "r10" }));
  mkdirSync(join(host, ".testing-agent", "tmp", "extra"), { recursive: true });
  await cleanupRun(host, { close: () => {} });
  assert.equal(existsSync(join(host, ".testing-agent", "tmp")), false);
});

// 6.3
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

test("attach mode shares one browser: one account at a time, state cleared first", () => {
  const text = `## Setup\nbrowser: brave\nbrowser_mode: attach\n${sample().replace("## Setup\n", "")}`;
  const plan = buildPlan(parseInstructions(text), "all", { runId: "r11" });
  assert.equal(plan.maxParallel, 1);
  assert.ok(plan.sessions.every((s) => s.clearStateFirst === true));
  const own = buildPlan(parseInstructions(sample()), "all", { runId: "r12" });
  assert.ok(own.sessions.every((s) => s.clearStateFirst === false));
});
