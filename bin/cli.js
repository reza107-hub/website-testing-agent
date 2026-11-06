#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../scripts/install.js";
import { parseInstructions } from "../scripts/instructions.js";
import { checkBrowserWindowVisible } from "../scripts/browser.js";
import { TMP_DIR, buildPlan, cleanupRun, loadState, preflight, saveState, markSignInFailed } from "../scripts/run.js";
import { latestResult, validateIssue, writeReport } from "../scripts/report.js";
import { stripeKeyMode } from "../scripts/guards.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const host = process.cwd();

const HELP = `site-tester ${pkg.version}

Setup
  init [--skip-browser]                 Attach the testing agent to this project

Run (used by the /test command)
  plan [feature|all] [--headed|--headless]   Check the setup and write the run plan (no name lists features)
  desktop-check --title T               Confirm agent-desktop can see the browser window showing page title T
  mark-failed --account A [--reason R] [--screenshot F]   Record a failed sign-in
  add-result --feature F --account A --status pass|fail|skipped
  add-skip --feature F --account A --reason R
  add-issue <issue.json>                Validate and record one issue
  report                                Build the HTML report and result file
  cleanup                               Close this run's browser sessions and temp files

Other
  check                                 Exit non-zero when the latest run failed
  stripe-mode <publishable key>         Print test, live or unknown (exit 0 only for test)
  --help | --version
`;

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const out = (v) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);
const fail = (msg, code = 1) => {
  process.stderr.write(`${msg}\n`);
  process.exitCode = code;
};

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === undefined || command === "--help" || command === "-h") return out(HELP.trimEnd());
  if (command === "--version" || command === "-v") return out(pkg.version);

  if (command === "init") {
    const lines = init({ hostDir: host, packageRoot, skipBrowser: args.includes("--skip-browser") });
    for (const line of lines) out(`- ${line}`);
    if (lines.some((l) => l.startsWith("Warning:"))) {
      process.exitCode = 1;
      return out("\nSetup is not finished. Fix the warning above, then run init again.");
    }
    return out("\nNext: edit .testing-agent/instructions.md, then ask Claude Code: /test all");
  }

  if (command === "plan") {
    const request = args.find((a) => !a.startsWith("--"));
    let text;
    try {
      text = readFileSync(join(host, ".testing-agent", "instructions.md"), "utf8");
    } catch {
      return fail("Cannot read .testing-agent/instructions.md. Run: site-tester init");
    }
    const parsed = parseInstructions(text);
    if (parsed.errors.length) return fail(`instructions.md has problems:\n- ${parsed.errors.join("\n- ")}`);
    if (!request) return fail(`Say what to test: a feature name or all. Declared features: ${parsed.features.map((f) => f.name).join(", ") || "none"}`);
    const headed = args.includes("--headed") ? true : args.includes("--headless") ? false : undefined;
    const plan = buildPlan(parsed, request, { headed });
    if (plan.error) return fail(`${plan.error}. Declared features: ${plan.declared.join(", ") || "none"}`);
    const pre = await preflight(plan);
    if (!pre.ok) return fail(`Preflight stopped the run: ${pre.error}`);
    saveState(host, pre.plan);
    const browser = { ...(pre.browser.open ?? {}), ...(pre.browser.attach ? { attach: pre.browser.attach } : {}) };
    if (browser.config) {
      browser.configPath = join(host, TMP_DIR, "chromium-config.json");
      writeFileSync(browser.configPath, JSON.stringify(browser.config));
      delete browser.config;
    }
    return out({ ...pre.plan, browser });
  }

  if (command === "desktop-check") {
    const text = readFileSync(join(host, ".testing-agent", "instructions.md"), "utf8");
    const r = checkBrowserWindowVisible(parseInstructions(text).setup, { pageTitle: flag(args, "--title") });
    out(r.ok ? (r.checked ? "visible" : "desktop control is off") : r.error);
    if (!r.ok) process.exitCode = 1;
    return;
  }

  if (command === "stripe-mode") {
    const mode = stripeKeyMode(args[0]);
    out(mode);
    if (mode !== "test") process.exitCode = 1;
    return;
  }

  if (command === "check") {
    const latest = latestResult(host);
    if (!latest) return fail("No report found. Run /test first.", 2);
    const { status, counts } = latest.result;
    out(`${status}: ${counts.issues} issue(s), ${counts.passed} passed, ${counts.notRun} not run (${latest.dir})`);
    if (status !== "pass") process.exitCode = 1;
    return;
  }

  // The remaining commands work on the run in progress.
  if (command === "cleanup") {
    const { closed } = await cleanupRun(host);
    return out(`Closed ${closed.length} session(s) and removed temp files`);
  }

  if (!["mark-failed", "add-result", "add-skip", "add-issue", "report"].includes(command)) {
    return fail(`Unknown command: ${command}\n\n${HELP}`);
  }
  const NEEDS = {
    "mark-failed": ["--account"],
    "add-result": ["--feature", "--account", "--status"],
    "add-skip": ["--feature", "--account", "--reason"],
  };
  if (args.includes("--help") || args.includes("-h")) {
    const needs = NEEDS[command] ?? ["<file>"];
    return out(`Usage: site-tester ${command} ${needs.map((n) => (n.startsWith("--") ? `${n} <value>` : n)).join(" ")}`);
  }
  const missing = (NEEDS[command] ?? []).filter((n) => {
    const v = flag(args, n);
    return v === undefined || v.startsWith("--") || v.trim() === "";
  });
  if (missing.length) return fail(`Nothing recorded. Missing: ${missing.join(", ")}`);
  const state = loadState(host);

  if (command === "mark-failed") {
    const account = flag(args, "--account");
    if (!account) return fail("Missing --account");
    markSignInFailed(state, account, { reason: flag(args, "--reason"), screenshot: flag(args, "--screenshot") });
    saveState(host, state);
    return out(`Recorded failed sign-in for "${account}"`);
  }
  if (command === "add-result") {
    const status = flag(args, "--status");
    if (!["pass", "fail", "skipped"].includes(status)) return fail("--status must be pass, fail or skipped");
    state.results.push({ feature: flag(args, "--feature"), account: flag(args, "--account"), status });
    saveState(host, state);
    return out("Recorded");
  }
  if (command === "add-skip") {
    state.skipped.push({ name: `${flag(args, "--feature")} (${flag(args, "--account")})`, reason: flag(args, "--reason") });
    saveState(host, state);
    return out("Recorded");
  }
  if (command === "add-issue") {
    let issue;
    try {
      issue = JSON.parse(readFileSync(args[0], "utf8"));
    } catch {
      return fail(`Cannot read issue file: ${args[0]}`);
    }
    const errors = validateIssue(issue);
    if (errors.length) return fail(`Issue not recorded: ${errors.join("; ")}`);
    state.issues.push(issue);
    saveState(host, state);
    return out(`Recorded issue: ${issue.title}`);
  }
  const { dir, result } = writeReport(host, state);
  return out({ report: join(dir, "report.html"), result });
}

main().catch((err) => fail(err.message));
