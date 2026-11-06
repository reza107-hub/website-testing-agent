import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { buildTasks, latestResult, validateIssue, writeReport } from "../scripts/report.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const goodIssue = (over = {}) => ({
  title: "Checkout button does nothing",
  severity: "high",
  feature: "checkout",
  target: "local",
  account: "recipe",
  steps: ["Open /cart", "Click Pay"],
  expected: "The order page opens",
  actual: "Nothing happens",
  console: ["TypeError: x is undefined"],
  network: ["POST /api/pay 500"],
  fixSuggestion: "Check the pay handler for an undefined value. Add a visible error when the request fails.",
  screenshot: ".testing-agent/tmp/screens/a.png",
  ...over,
});

function hostWithScreens(...names) {
  const host = mkdtempSync(join(tmpdir(), "st-rep-"));
  mkdirSync(join(host, ".testing-agent", "tmp", "screens"), { recursive: true });
  for (const n of names) writeFileSync(join(host, ".testing-agent", "tmp", "screens", n), PNG);
  return host;
}

const baseRun = (over = {}) => ({
  request: "all",
  startedAt: new Date(Date.now() - 5000).toISOString(),
  sessions: [{ account: "recipe", features: [{ target: "local" }] }],
  results: [],
  issues: [],
  skipped: [],
  notRun: [],
  ...over,
});

// 7.1
test("a valid issue has no problems", () => {
  assert.deepEqual(validateIssue(goodIssue()), []);
});

test("every required field is enforced", () => {
  for (const f of ["title", "feature", "target", "account", "expected", "actual", "fixSuggestion", "screenshot"]) {
    const errs = validateIssue(goodIssue({ [f]: "" }));
    assert.ok(errs.some((e) => e.includes(f)), `missing ${f} should be reported`);
  }
  assert.ok(validateIssue(goodIssue({ steps: [] })).some((e) => /steps/.test(e)));
  assert.ok(validateIssue(goodIssue({ severity: "urgent" })).some((e) => /severity/.test(e)));
  assert.ok(validateIssue(goodIssue({ console: "x" })).some((e) => /console/.test(e)));
});

// 7.4
test("a fix suggestion with code or more than three sentences is rejected", () => {
  assert.ok(validateIssue(goodIssue({ fixSuggestion: "Use ```x = 1``` here." })).some((e) => /no code/.test(e)));
  assert.ok(validateIssue(goodIssue({ fixSuggestion: "Set the `value` first." })).some((e) => /no code/.test(e)));
  assert.ok(validateIssue(goodIssue({ fixSuggestion: "One. Two. Three. Four." })).some((e) => /one to three/.test(e)));
  assert.deepEqual(validateIssue(goodIssue({ fixSuggestion: "Version 1.2 needs a check. Then retry" })), []);
});

// 7.2, 7.3
test("mixed run: report embeds the issue screenshot and no image files remain", () => {
  const host = hostWithScreens("a.png", "pass-1.png", "pass-2.png");
  const run = baseRun({
    issues: [goodIssue()],
    results: [
      { feature: "login", account: "recipe", status: "pass" },
      { feature: "checkout", account: "recipe", status: "fail" },
    ],
  });
  const { dir, result } = writeReport(host, run);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length, 1);
  assert.match(html, /Checkout button does nothing/);
  assert.match(html, /Suggested fix/);
  assert.equal(result.status, "fail");
  assert.deepEqual(result.counts, { passed: 1, failed: 1, skipped: 0, notRun: 0, issues: 1 });
  assert.deepEqual(readdirSync(join(host, ".testing-agent", "tmp", "screens")), []);
});

test("all-pass run: only the report and result file exist, and the report says so", () => {
  const host = hostWithScreens("p.png");
  const { dir, result } = writeReport(host, baseRun({ results: [{ feature: "a", account: "b", status: "pass" }] }));
  assert.deepEqual(readdirSync(dir).sort(), ["report.html", "result.json", "tasks.md"]);
  assert.match(readFileSync(join(dir, "report.html"), "utf8"), /No issues were found/);
  assert.equal(result.status, "pass");
  assert.deepEqual(readdirSync(join(host, ".testing-agent", "tmp", "screens")), []);
});

test("report is self-contained: no external resources, text is escaped", () => {
  const host = hostWithScreens("a.png");
  const { dir } = writeReport(host, baseRun({ issues: [goodIssue({ title: "<script>alert(1)</script>" })] }));
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /(src|href)="https?:/);
  assert.doesNotMatch(html, /@import|url\(http|<link/);
});

test("an invalid issue stops the report instead of writing a bad file", () => {
  const host = hostWithScreens("a.png");
  assert.throws(() => writeReport(host, baseRun({ issues: [goodIssue({ steps: [] })] })), /not valid/);
  assert.equal(readdirSync(join(host, ".testing-agent", "tmp", "screens")).length, 1);
});

test("skipped steps and not-run features are listed with reasons", () => {
  const host = hostWithScreens();
  const { dir } = writeReport(host, baseRun({
    skipped: [{ name: "pay (recipe)", reason: "live Stripe key" }],
    notRun: [{ name: "profile (tech)", reason: "target did not respond" }],
  }));
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.match(html, /pay \(recipe\): live Stripe key/);
  assert.match(html, /profile \(tech\): target did not respond/);
});

// 7.6
test("report and run code make no network calls and no tracker calls", () => {
  for (const f of ["../scripts/report.js", "../scripts/guards.js"]) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
    assert.doesNotMatch(src, /fetch\(|node:https?|node:net|XMLHttpRequest|api\.github|createIssue/);
  }
});

test("latestResult returns the newest run", () => {
  const host = mkdtempSync(join(tmpdir(), "st-latest-"));
  for (const [d, status] of [["2026-01-01_00-00-00", "fail"], ["2026-02-01_00-00-00", "pass"]]) {
    mkdirSync(join(host, ".testing-agent", "reports", d), { recursive: true });
    writeFileSync(join(host, ".testing-agent", "reports", d, "result.json"), JSON.stringify({ status, counts: {} }));
  }
  assert.equal(latestResult(host).result.status, "pass");
  assert.equal(latestResult(mkdtempSync(join(tmpdir(), "st-none-"))), null);
});

// 7.5 and the whole CLI flow
const cli = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
function runCli(cwd, ...args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli", SITE_TESTER_UNATTENDED: "" } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("check exits 1 on a failed run, 0 on a passing run, 2 with no report", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-check-"));
  assert.equal((await runCli(host, "check")).code, 2);
  const put = (d, status) => {
    mkdirSync(join(host, ".testing-agent", "reports", d), { recursive: true });
    writeFileSync(join(host, ".testing-agent", "reports", d, "result.json"),
      JSON.stringify({ status, counts: { issues: status === "fail" ? 1 : 0, passed: 1, notRun: 0 } }));
  };
  put("2026-01-01_00-00-00", "fail");
  assert.equal((await runCli(host, "check")).code, 1);
  put("2026-02-01_00-00-00", "pass");
  assert.equal((await runCli(host, "check")).code, 0);
});

test("stripe-mode command exits 0 only for a test key", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-stripe-"));
  assert.equal((await runCli(host, "stripe-mode", "pk_test_abc123")).code, 0);
  assert.equal((await runCli(host, "stripe-mode", "pk_live_abc123")).code, 1);
  assert.equal((await runCli(host, "stripe-mode")).code, 1);
});

const FLOW_INSTRUCTIONS = (url) => `## Targets
- app: ${url}
- gone: http://127.0.0.1:1

## Accounts
- one: email=a@x.test | password=1 | plan=pro
- two: email=b@x.test | password=2 | plan=free

## Feature: home
steps:
- Open /
expect:
- Page loads

## Feature: other
steps:
- Open /other
expect:
- Page loads
`;

function flowHost(url) {
  const host = mkdtempSync(join(tmpdir(), "st-flow-"));
  mkdirSync(join(host, ".testing-agent"), { recursive: true });
  writeFileSync(join(host, ".testing-agent", "instructions.md"), FLOW_INSTRUCTIONS(url));
  return host;
}

const noRunState = (host) => assert.throws(() => readFileSync(join(host, ".testing-agent", "tmp", "run.json")), /ENOENT/);

// 3.1 the three ways plan can refuse, and what each prints
test("plan: exit 3 when the target or accounts are missing, exit 4 for an undeclared name; neither starts a run", async () => {
  const host = flowHost("http://127.0.0.1:9");

  const none = await runCli(host, "plan", "home");
  assert.equal(none.code, 3);
  const noneJson = JSON.parse(none.stdout);
  assert.equal(noneJson.status, "missing");
  assert.deepEqual(noneJson.missing, ["target", "accounts"]);
  assert.deepEqual(noneJson.declared.targets.map((t) => t.name), ["app", "gone"]);
  assert.deepEqual(noneJson.declared.accounts, [
    { name: "one", labels: { plan: "pro" } },
    { name: "two", labels: { plan: "free" } },
  ]);
  assert.match(none.stderr, /Nothing was opened/);
  noRunState(host);

  const noTarget = await runCli(host, "plan", "home", "--accounts", "one");
  assert.equal(noTarget.code, 3);
  assert.deepEqual(JSON.parse(noTarget.stdout).missing, ["target"]);

  const noAccounts = await runCli(host, "plan", "home", "--target", "app");
  assert.equal(noAccounts.code, 3);
  assert.deepEqual(JSON.parse(noAccounts.stdout).missing, ["accounts"]);

  const unknown = await runCli(host, "plan", "home", "--target", "app", "--accounts", "one,ghost");
  assert.equal(unknown.code, 4);
  const unknownJson = JSON.parse(unknown.stdout);
  assert.equal(unknownJson.status, "unknown");
  assert.deepEqual(unknownJson.unknown, { accounts: ["ghost"] });
  assert.deepEqual(unknownJson.declared.accounts.map((a) => a.name), ["one", "two"]);

  const badFeature = await runCli(host, "plan", "checkout", "--target", "app", "--accounts", "one");
  assert.equal(badFeature.code, 4);
  assert.deepEqual(JSON.parse(badFeature.stdout).declared.features, ["home", "other"]);
  noRunState(host);
});

test("plan with no name at all asks for the feature and lists the declared ones", async () => {
  const host = flowHost("http://127.0.0.1:9");
  const r = await runCli(host, "plan");
  assert.equal(r.code, 3);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.missing, ["feature", "target", "accounts"]);
  assert.deepEqual(j.declared.features, ["home", "other"]);
});

test("CLI flow: plan with flags, record, report, tasks.md, check, cleanup against a real local server", async () => {
  const server = createServer((_q, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const host = flowHost(url);
  try {
    // words and extras may contain spaces and quotes; flags may come before the name
    const plan = await runCli(host, "plan", "--target", "APP", "--accounts", "one, two", "--words", 'on app using "one" and the free account', "--extra", "the footer is shown", "all");
    assert.equal(plan.code, 0, plan.stderr);
    const parsed = JSON.parse(plan.stdout);
    assert.deepEqual(parsed.sessions.map((s) => s.account), ["one", "two"]);
    assert.deepEqual(parsed.sessions.map((s) => s.features), [["home", "other"], ["home", "other"]]);
    assert.equal(parsed.request.words, 'on app using "one" and the free account');
    assert.deepEqual(parsed.request.extras, ["the footer is shown"]);
    assert.equal(parsed.target.name, "app");
    assert.equal(parsed.headed, false);
    assert.ok(readFileSync(parsed.browser.configPath, "utf8").includes("chromium"));

    assert.equal((await runCli(host, "add-result", "--feature", "home", "--account", "one", "--status", "pass")).code, 0);
    mkdirSync(join(host, ".testing-agent", "tmp", "screens"), { recursive: true });
    writeFileSync(join(host, ".testing-agent", "tmp", "screens", "a.png"), PNG);
    writeFileSync(join(host, "issue.json"), JSON.stringify(goodIssue({ feature: "home", target: "app", account: "two" })));
    assert.equal((await runCli(host, "add-issue", "issue.json")).code, 0);

    writeFileSync(join(host, "bad.json"), JSON.stringify(goodIssue({ fixSuggestion: "`code`" })));
    const bad = await runCli(host, "add-issue", "bad.json");
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /no code/);

    const rep = await runCli(host, "report");
    assert.equal(rep.code, 0, rep.stderr);
    const result = JSON.parse(rep.stdout).result;
    assert.equal(result.status, "fail");
    const dir = join(host, ".testing-agent", "reports", readdirSync(join(host, ".testing-agent", "reports"))[0]);
    assert.deepEqual(readdirSync(dir).sort(), ["report.html", "result.json", "tasks.md"]);
    const html = readFileSync(join(dir, "report.html"), "utf8");
    assert.match(html, /on app using &quot;one&quot; and the free account/);
    assert.match(html, /the footer is shown/);
    assert.match(readFileSync(join(dir, "tasks.md"), "utf8"), /- \[ \] \[high\] Checkout button does nothing/);
    assert.equal((await runCli(host, "check")).code, 1);

    const clean = await runCli(host, "cleanup");
    assert.equal(clean.code, 0);
    assert.deepEqual(readdirSync(join(host, ".testing-agent")).sort(), ["instructions.md", "reports"]);
  } finally {
    server.close();
  }
});

test("plan: an unreachable target skips every feature but the run still plans, and cleanup closes the sessions", async () => {
  const host = flowHost("http://127.0.0.1:9");
  const plan = await runCli(host, "plan", "all", "--target", "gone", "--accounts", "one");
  assert.equal(plan.code, 0, plan.stderr);
  const p = JSON.parse(plan.stdout);
  assert.equal(p.notRun.length, 2);
  assert.ok(p.sessions.every((s) => s.features.length === 0 && /did not respond/.test(s.skipped)));
  await runCli(host, "cleanup");
});

// 3.5
test("abort writes a failing result with the reason and no browser is needed; check then exits 1", async () => {
  const host = flowHost("http://127.0.0.1:9");
  const r = await runCli(host, "abort", "--reason", "the target was not given and nobody could answer", "--words", "stepgen");
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout).result;
  assert.equal(result.status, "fail");
  assert.equal(result.reason, "the target was not given and nobody could answer");
  assert.equal(result.counts.notRun, 1);
  const check = await runCli(host, "check");
  assert.equal(check.code, 1);
  assert.match(check.stdout, /Reason: the target was not given/);
  const dir = join(host, ".testing-agent", "reports", readdirSync(join(host, ".testing-agent", "reports"))[0]);
  assert.match(readFileSync(join(dir, "tasks.md"), "utf8"), /Find out why this did not run: The run/);
  assert.equal((await runCli(host, "abort")).code, 1, "a reason is required");
});

// 6.1
test("latest prints the newest report's path and size, or says none exists", async () => {
  const empty = mkdtempSync(join(tmpdir(), "st-latest-cli-"));
  const none = await runCli(empty, "latest");
  assert.equal(none.code, 1);
  assert.match(none.stderr, /No report found/);

  const host = hostWithScreens();
  writeReport(host, baseRun({ results: [{ feature: "a", account: "b", status: "pass" }] }), new Date("2026-01-01T00:00:00Z"));
  const newer = writeReport(host, baseRun({ issues: [goodIssue()] }), new Date("2026-02-01T00:00:00Z"));
  const r = await runCli(host, "latest");
  assert.equal(r.code, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.dir, newer.dir);
  assert.equal(j.report, join(newer.dir, "report.html"));
  assert.equal(j.bytes, statSync(j.report).size);
  assert.equal(j.status, "fail");
});

test("run commands without a plan explain what to do", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-noplan-"));
  const r = await runCli(host, "report");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No run in progress/);
  const u = await runCli(host, "nope");
  assert.equal(u.code, 1);
  assert.match(u.stderr, /Unknown command: nope/);
});

// 5.1 5.2 5.3
const run3 = () => baseRun({
  request: { feature: "all", words: "on beta using the recipe account", target: "beta", accounts: ["recipe"], extras: ["the footer is shown"] },
  features: [{ name: "login" }, { name: "checkout" }],
  repairs: [{ what: "Added a web scheme to a target address", old: "- beta: beta.test", new: "- beta: https://beta.test" }],
  issues: [
    goodIssue({ title: "Low thing", severity: "low" }),
    goodIssue({ title: "High thing", severity: "high" }),
    goodIssue({ title: "Critical thing", severity: "critical" }),
    goodIssue({ title: "Another high thing", severity: "high" }),
  ],
  notRun: [{ name: "profile (recipe)", reason: "target \"beta\" did not respond" }],
});

test("tasks: one per issue ordered critical to low (ties keep their order), then one per not-run feature", () => {
  const tasks = buildTasks(run3());
  assert.deepEqual(tasks.map((t) => t.title), [
    "Critical thing", "High thing", "Another high thing", "Low thing",
    "Find out why this did not run: profile (recipe)",
  ]);
  assert.deepEqual(tasks.map((t) => t.severity), ["critical", "high", "high", "low", "not run"]);
  assert.match(tasks[4].actual, /did not respond/);
});

test("the HTML report puts the task list above the issues and shows each task's fix or reason", () => {
  const host = hostWithScreens("a.png");
  const { dir } = writeReport(host, run3());
  const html = readFileSync(join(dir, "report.html"), "utf8");
  assert.ok(html.indexOf("<h2>Tasks</h2>") < html.indexOf("<h2>Issues</h2>"));
  assert.ok(html.indexOf("Critical thing") < html.indexOf("Low thing"));
  assert.equal((html.match(/<input type="checkbox">/g) ?? []).length, 5);
  assert.match(html, /did not respond/);
});

test("a clean run says there are no tasks, in the report and in tasks.md", () => {
  const host = hostWithScreens();
  const { dir } = writeReport(host, baseRun({ results: [{ feature: "a", account: "b", status: "pass" }] }));
  assert.match(readFileSync(join(dir, "report.html"), "utf8"), /There are no tasks/);
  assert.match(readFileSync(join(dir, "tasks.md"), "utf8"), /There are no tasks/);
  assert.doesNotMatch(readFileSync(join(dir, "tasks.md"), "utf8"), /- \[ \]/);
});

test("tasks.md is plain checkbox lines with no image data, no code fences and no backticks", () => {
  const host = hostWithScreens("a.png");
  const run = run3();
  run.issues[0] = goodIssue({
    title: "Has `code` in it",
    severity: "low",
    steps: ["Open `/cart`", "Click \"Pay\"\n```js\nconsole.log(1)\n```"],
    actual: "It shows `undefined`",
    screenshot: ".testing-agent/tmp/screens/a.png",
  });
  const { dir } = writeReport(host, run);
  const md = readFileSync(join(dir, "tasks.md"), "utf8");
  assert.equal((md.match(/^- \[ \] /gm) ?? []).length, 5);
  assert.doesNotMatch(md, /data:image|base64|```|`/);
  assert.match(md, /Report: report\.html/);
  assert.match(md, /Steps: 1\. Open \/cart 2\. Click "Pay"/);
  assert.match(md, /Suggested fix: /);
  assert.ok(md.indexOf("[critical]") < md.indexOf("[low]"));
});

test("the report header shows the words, target, accounts, features, run-only checks and repairs", () => {
  const host = hostWithScreens();
  const { dir } = writeReport(host, run3());
  const html = readFileSync(join(dir, "report.html"), "utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(html, /Request all on beta using the recipe account/);
  assert.match(html, /Target beta/);
  assert.match(html, /Accounts recipe/);
  assert.match(html, /Features run login, checkout/);
  assert.match(html, /Run-only checks: the footer is shown/);
  assert.match(html, /Repairs made to instructions\.md: Added a web scheme to a target address \(- beta: beta\.test to - beta: https:\/\/beta\.test\)/);
});

test("an old-style run (the request is a plain string) still builds a report", () => {
  const host = hostWithScreens();
  const { dir } = writeReport(host, baseRun({ request: "all" }));
  assert.match(readFileSync(join(dir, "report.html"), "utf8"), /Request<\/th><td>all<\/td>/);
});

test("a skip recorded twice is counted once", () => {
  const host = hostWithScreens();
  const { result } = writeReport(host, baseRun({
    skipped: [{ name: "pay (recipe)", reason: "live key" }],
    results: [{ feature: "pay", account: "recipe", status: "skipped" }],
  }));
  assert.equal(result.counts.skipped, 1);
});

test("add-skip, add-result and mark-failed record nothing when arguments are missing or are --help", async () => {
  const { saveState, loadState } = await import("../scripts/run.js");
  const host = mkdtempSync(join(tmpdir(), "st-args-"));
  saveState(host, { runId: "x", sessions: [], notRun: [], issues: [], results: [], skipped: [] });
  for (const args of [["add-skip", "--help"], ["add-skip", "--feature", "f"], ["add-result", "--feature", "f", "--account", "a"],
    ["add-result", "--feature", "f", "--account", "a", "--status", "maybe"], ["mark-failed"], ["add-skip", "--feature", "--account", "a", "--reason", "r"]]) {
    const r = await runCli(host, ...args);
    if (args.includes("--help")) assert.equal(r.code, 0);
    else assert.equal(r.code, 1, `${args.join(" ")} should fail`);
  }
  const state = loadState(host);
  assert.deepEqual([state.skipped, state.results, state.issues], [[], [], []]);
  const ok = await runCli(host, "add-skip", "--feature", "f", "--account", "a", "--reason", "r");
  assert.equal(ok.code, 0);
  assert.equal(loadState(host).skipped.length, 1);
});

test("a run with no issues but a feature not run is a fail, and check exits 1", async () => {
  const host = hostWithScreens();
  const { result } = writeReport(host, baseRun({
    results: [{ feature: "a", account: "b", status: "pass" }],
    notRun: [{ name: "profile (tech)", reason: "target did not respond" }],
  }));
  assert.equal(result.status, "fail");
  assert.equal(result.counts.issues, 0);
  assert.equal(result.counts.notRun, 1);
  const r = await runCli(host, "check");
  assert.equal(r.code, 1);
  assert.match(r.stdout, /fail: 0 issue\(s\), 1 passed, 1 not run/);
});

test("skipped steps alone do not fail a run, and check exits 0", async () => {
  const host = hostWithScreens();
  const { result } = writeReport(host, baseRun({
    results: [{ feature: "a", account: "b", status: "pass" }],
    skipped: [{ name: "pay (b)", reason: "live Stripe key" }],
  }));
  assert.equal(result.status, "pass");
  assert.equal(result.counts.skipped, 1);
  assert.equal((await runCli(host, "check")).code, 0);
});

// an unattended run cannot ask, so the helper stops it by itself
const runCliEnv = (cwd, env, ...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, SITE_TESTER_UNATTENDED: "", ...env } });
  let stdout = "";
  let stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  p.on("close", (code) => resolve({ code, stdout, stderr }));
});

test("unattended (claude -p or SITE_TESTER_UNATTENDED=1): missing or unknown names stop the run with exit 5 and a failing result, before anything opens", async () => {
  for (const env of [{ CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }, { CLAUDE_CODE_ENTRYPOINT: "cli", SITE_TESTER_UNATTENDED: "1" }]) {
    const host = flowHost("http://127.0.0.1:9");
    const missing = await runCliEnv(host, env, "plan", "home");
    assert.equal(missing.code, 5, missing.stderr);
    const j = JSON.parse(missing.stdout);
    assert.equal(j.status, "aborted");
    assert.match(j.reason, /Missing: target, accounts\./);
    assert.match(j.reason, /Declared targets: app, gone\. Declared accounts: one \(plan=pro\), two \(plan=free\)\. Declared features: home, other\./);
    assert.equal(j.result.status, "fail");
    assert.equal((await runCliEnv(host, env, "check")).code, 1, "check now fails for CI");
    noRunState(host);

    const unknown = await runCliEnv(host, env, "plan", "home", "--target", "app", "--accounts", "ghost");
    assert.equal(unknown.code, 5);
    assert.match(JSON.parse(unknown.stdout).reason, /Not declared in instructions\.md: accounts "ghost"/);
  }
});

test("interactive (entrypoint cli, no switch): the same request exits 3 so the agent can ask", async () => {
  const host = flowHost("http://127.0.0.1:9");
  const r = await runCliEnv(host, { CLAUDE_CODE_ENTRYPOINT: "cli" }, "plan", "home");
  assert.equal(r.code, 3);
  assert.equal(JSON.parse(r.stdout).status, "missing");
  assert.throws(() => readdirSync(join(host, ".testing-agent", "reports")), /ENOENT/, "no result was written");
});

test("a valid unattended request still plans normally", async () => {
  const server = createServer((_q, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = flowHost(`http://127.0.0.1:${server.address().port}`);
  try {
    const r = await runCliEnv(host, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }, "plan", "home", "--target", "app", "--accounts", "one");
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).sessions.length, 1);
    await runCli(host, "cleanup");
  } finally {
    server.close();
  }
});

test("declared prints the features, targets and accounts with labels, and writes nothing, even unattended", async () => {
  const host = flowHost("http://127.0.0.1:9");
  for (const env of [{ CLAUDE_CODE_ENTRYPOINT: "cli" }, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }]) {
    const r = await runCliEnv(host, env, "declared");
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.features, ["home", "other"]);
    assert.deepEqual(j.targets.map((t) => t.name), ["app", "gone"]);
    assert.deepEqual(j.accounts, [{ name: "one", labels: { plan: "pro" } }, { name: "two", labels: { plan: "free" } }]);
  }
  assert.deepEqual(readdirSync(join(host, ".testing-agent")), ["instructions.md"], "no reports folder and no temp folder");
  const empty = mkdtempSync(join(tmpdir(), "st-nodecl-"));
  assert.equal((await runCli(empty, "declared")).code, 1);
});

test("an ambiguous label: exit 4 so the agent can ask; exit 5 and a failing result when nobody can answer", async () => {
  const host = flowHost("http://127.0.0.1:9");
  const ask = await runCliEnv(host, { CLAUDE_CODE_ENTRYPOINT: "cli" }, "plan", "home", "--target", "app", "--accounts", "plan=pro,plan=free");
  assert.equal(ask.code, 0, "one account fits each label, so this one is fine");
  await runCli(host, "cleanup");

  const text = readFileSync(join(host, ".testing-agent", "instructions.md"), "utf8").replace("- two:", "- three: email=c@x.test | password=3 | plan=free\n- two:");
  writeFileSync(join(host, ".testing-agent", "instructions.md"), text);
  const interactive = await runCliEnv(host, { CLAUDE_CODE_ENTRYPOINT: "cli" }, "plan", "home", "--target", "app", "--accounts", "plan=free");
  assert.equal(interactive.code, 4);
  const j = JSON.parse(interactive.stdout);
  assert.equal(j.status, "ambiguous");
  assert.deepEqual(j.ambiguous[0].candidates, ["three", "two"], "in the order they are declared");
  noRunState(host);

  const unattended = await runCliEnv(host, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }, "plan", "home", "--target", "app", "--accounts", "plan=free");
  assert.equal(unattended.code, 5);
  assert.match(JSON.parse(unattended.stdout).reason, /plan=free matches three, two/);
  assert.equal((await runCliEnv(host, {}, "check")).code, 1);
});
