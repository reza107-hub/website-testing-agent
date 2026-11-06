import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { latestResult, validateIssue, writeReport } from "../scripts/report.js";

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
  assert.deepEqual(readdirSync(dir).sort(), ["report.html", "result.json"]);
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
    const p = spawn(process.execPath, [cli, ...args], { cwd });
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

test("CLI flow: plan, record, report, check, cleanup against a real local server", async () => {
  const server = createServer((_q, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const host = mkdtempSync(join(tmpdir(), "st-flow-"));
  mkdirSync(join(host, ".testing-agent"), { recursive: true });
  writeFileSync(join(host, ".testing-agent", "instructions.md"), `## Targets
- app: ${url}
- gone: http://127.0.0.1:1

## Accounts
- one: email=a@x.test | password=1
- two: email=b@x.test | password=2

## Feature: home
target: app
steps:
- Open /
expect:
- Page loads

## Feature: broken
target: gone
steps:
- Open /
expect:
- Page loads
`);
  try {
    const plan = await runCli(host, "plan", "all");
    assert.equal(plan.code, 0, plan.stderr);
    const parsed = JSON.parse(plan.stdout);
    assert.equal(parsed.sessions.length, 2);
    assert.ok(parsed.sessions.every((s) => s.features.length === 1 && s.features[0].name === "home"));
    assert.equal(parsed.notRun.length, 2);

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
    assert.equal(JSON.parse(rep.stdout).result.status, "fail");
    assert.equal((await runCli(host, "check")).code, 1);

    const clean = await runCli(host, "cleanup");
    assert.equal(clean.code, 0);
    assert.deepEqual(readdirSync(join(host, ".testing-agent")).sort(), ["instructions.md", "reports"]);
  } finally {
    server.close();
  }
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

test("plan with no name lists the declared features instead of guessing", async () => {
  const host = mkdtempSync(join(tmpdir(), "st-list-"));
  mkdirSync(join(host, ".testing-agent"), { recursive: true });
  writeFileSync(join(host, ".testing-agent", "instructions.md"),
    "## Targets\n- a: http://127.0.0.1:1\n\n## Feature: one\nsteps:\n- s\nexpect:\n- e\n");
  const r = await runCli(host, "plan");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Declared features: one/);
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
