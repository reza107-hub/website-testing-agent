#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../scripts/install.js";
import { checkBrowserWindowVisible } from "../scripts/browser.js";
import { declaredNames, parseInstructions } from "../scripts/instructions.js";
import { errorsOf, fixTargetSchemes, formatProblems, lintText } from "../scripts/lint.js";
import {
  TMP_DIR, addRepairs, buildAbortRun, buildPlan, cleanupRun, describeDeclared, isUnattended, loadRepairs, loadState, markSignInFailed,
  preflight, saveState,
} from "../scripts/run.js";
import { latestResult, validateIssue, writeReport } from "../scripts/report.js";
import { stripeKeyMode } from "../scripts/guards.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const host = process.cwd();
const INSTRUCTIONS = join(host, ".testing-agent", "instructions.md");

const HELP = `site-tester ${pkg.version}

Setup
  init [--skip-browser]                 Attach the testing agent to this project

Run (used by the /test command)
  plan [feature|all] --target T --accounts A,B [--words "..."] [--extra "..."] [--headed|--headless]
                                        Check the file and the setup, then write the run plan.
                                        Exit 3: target or accounts missing. Exit 4: a name is not declared, or a label such as plan=free fits
                                        more than one account. --accounts takes names or labels (recipe,plan=free).
                                        Exit 2: instructions.md has a problem.
                                        Exit 5: as 3 or 4, but nobody can answer (claude -p, or SITE_TESTER_UNATTENDED=1),
                                        so it wrote a failing result and stopped.
  declared                              Print the declared features, targets and accounts (with labels).
                                        Read-only: it starts nothing and writes nothing.
  mark-failed --account A [--reason R] [--screenshot F]   Record a failed sign-in
  add-result --feature F --account A --status pass|fail|skipped
  add-skip --feature F --account A --reason R
  add-issue <issue.json>                Validate and record one issue
  report                                Build the HTML report, tasks.md and result file
  cleanup                               Close this run's browser sessions and temp files
  abort --reason R [--words W]          End a run that could not start, as a failing result
  desktop-check --title T               Confirm agent-desktop can see the browser window showing page title T

Check the file
  lint [--fix]                          Explain problems in instructions.md in plain words.
                                        --fix adds http:// or https:// to a target address that has none.

Other
  check                                 Exit non-zero when the latest run failed or left a feature unrun
  latest                                Print the newest report's path and size
  stripe-mode <publishable key>         Print test, live or unknown (exit 0 only for test)
  --help | --version
`;

const VALUE_FLAGS = new Set(["--target", "--accounts", "--words", "--extra"]);

function parseArgs(args) {
  const out = { positional: [], flags: {}, accounts: [], extras: [], bool: new Set() };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) {
      const v = args[++i] ?? "";
      if (a === "--accounts") out.accounts.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
      else if (a === "--extra") out.extras.push(v);
      else out.flags[a] = v;
    } else if (a.startsWith("--")) {
      out.bool.add(a);
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
const out = (v) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);
const fail = (msg, code = 1) => {
  process.stderr.write(`${msg}\n`);
  process.exitCode = code;
};

function readInstructions() {
  try {
    return readFileSync(INSTRUCTIONS, "utf8");
  } catch {
    return null;
  }
}

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
    return out("\nNext: edit .testing-agent/instructions.md, then ask Claude Code: /test <feature> on <target> using <accounts>");
  }

  if (command === "lint") {
    let text = readInstructions();
    if (text === null) return fail("Cannot read .testing-agent/instructions.md. Run: site-tester init");
    if (args.includes("--fix")) {
      const fixed = fixTargetSchemes(text);
      if (fixed.changes.length) {
        writeFileSync(INSTRUCTIONS, fixed.text);
        addRepairs(host, fixed.changes.map((c) => ({ what: "Added a web scheme to a target address", old: c.old, new: c.new })));
        for (const c of fixed.changes) out(`Changed: ${c.old}\n     to: ${c.new}`);
        text = fixed.text;
      } else {
        out("Nothing to repair.");
      }
    }
    const { problems } = lintText(text);
    out(formatProblems(problems));
    if (errorsOf(problems).length) process.exitCode = 2;
    return;
  }

  if (command === "plan") {
    const a = parseArgs(args);
    const text = readInstructions();
    if (text === null) return fail("Cannot read .testing-agent/instructions.md. Run: site-tester init");

    const { problems, parsed } = lintText(text);
    if (errorsOf(problems).length) return fail(`instructions.md has problems, so the run did not start.\n\n${formatProblems(problems)}`, 2);
    if (problems.length) process.stderr.write(`${formatProblems(problems)}\n\n`);

    const headed = a.bool.has("--headed") ? true : a.bool.has("--headless") ? false : undefined;
    const built = buildPlan(parsed, a.positional[0], {
      target: a.flags["--target"],
      accounts: a.accounts,
      words: a.flags["--words"],
      extras: a.extras,
      headed,
      repairs: loadRepairs(host),
    });
    if (built.status !== "ok" && isUnattended()) {
      // Nobody can answer, so stop here, before any browser, with a failing result.
      const reason = `${built.message} ${describeDeclared(built.declared)}`;
      await cleanupRun(host);
      const { dir, result } = writeReport(host, buildAbortRun(reason, a.flags["--words"] ?? ""));
      out({ status: "aborted", reason, report: join(dir, "report.html"), result });
      process.stderr.write(`${reason} Nobody can answer here, so the run stopped before opening anything and wrote a failing result.\n`);
      process.exitCode = 5;
      return;
    }
    if (built.status !== "ok") {
      out(built);
      process.stderr.write(`${built.message} Ask the user, then run plan again. Nothing was opened.\n`);
      process.exitCode = built.status === "missing" ? 3 : 4; // unknown and ambiguous both exit 4
      return;
    }

    const pre = await preflight(built.plan);
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

  if (command === "declared") {
    const text = readInstructions();
    if (text === null) return fail("Cannot read .testing-agent/instructions.md. Run: site-tester init");
    return out(declaredNames(parseInstructions(text)));
  }

  if (command === "abort") {
    const reason = flag(args, "--reason");
    if (!reason) return fail("Missing --reason");
    await cleanupRun(host);
    const { dir, result } = writeReport(host, buildAbortRun(reason, flag(args, "--words") ?? ""));
    return out({ report: join(dir, "report.html"), result });
  }

  if (command === "desktop-check") {
    const text = readInstructions();
    if (text === null) return fail("Cannot read .testing-agent/instructions.md. Run: site-tester init");
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
    const { status, counts, reason } = latest.result;
    out(`${status}: ${counts.issues} issue(s), ${counts.passed} passed, ${counts.notRun} not run (${latest.dir})${reason ? `\nReason: ${reason}` : ""}`);
    if (status !== "pass") process.exitCode = 1;
    return;
  }

  if (command === "latest") {
    const latest = latestResult(host);
    if (!latest) return fail("No report found. Run /test first.");
    const report = join(latest.dir, latest.result.report ?? "report.html");
    return out({ dir: latest.dir, report, bytes: statSync(report).size, status: latest.result.status, finishedAt: latest.result.finishedAt });
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
