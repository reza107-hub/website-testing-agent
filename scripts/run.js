// Run planning, preflight, session cleanup, and run-state helpers. No dependencies.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { declaredNames, findName, selectFeatures } from "./instructions.js";
import { resolveBrowser, checkDesktopControl } from "./browser.js";

export const TMP_DIR = ".testing-agent/tmp";

// True when nobody can answer a question: the user set SITE_TESTER_UNATTENDED=1,
// or Claude Code is running in print mode (`claude -p`), which sets
// CLAUDE_CODE_ENTRYPOINT=sdk-cli. An interactive session sets it to "cli".
export function isUnattended(env = process.env) {
  return env.SITE_TESTER_UNATTENDED === "1" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli";
}

// What is declared, in one plain sentence each, for a message that cannot ask.
export function describeDeclared(declared) {
  const accounts = declared.accounts.map((a) => {
    const labels = Object.entries(a.labels).map(([k, v]) => `${k}=${v}`).join(", ");
    return labels ? `${a.name} (${labels})` : a.name;
  });
  return `Declared targets: ${declared.targets.map((t) => t.name).join(", ") || "none"}. Declared accounts: ${accounts.join(", ") || "none"}. Declared features: ${declared.features.join(", ") || "none"}.`;
}
export const STATE_FILE = "run.json";
export const REPAIRS_FILE = "repairs.json";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

// Runs worker over items with at most cap at once. A free slot takes the next
// item straight away. Returns results in item order.
export async function runQueue(items, cap, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Math.max(1, Math.min(cap, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}

// Turns a run request into a plan, or says what is missing or not declared.
//   { status: "ok", plan }
//   { status: "missing", missing: ["target" | "accounts"], declared, message }
//   { status: "unknown", unknown: { feature?, target?, accounts? }, declared, message }
//   { status: "ambiguous", ambiguous: [{ selector, candidates }], declared, message }
// Nothing here opens a browser. A run can only start from status "ok".
export function buildPlan(parsed, request, { target, accounts, words, extras, headed, runId = Date.now().toString(36), repairs = [] } = {}) {
  const declared = declaredNames(parsed);
  const asked = [...new Set((accounts ?? []).map((a) => String(a).trim()).filter(Boolean))];

  const missing = [];
  if (!request) missing.push("feature");
  if (!target) missing.push("target");
  if (asked.length === 0) missing.push("accounts");
  if (missing.length) {
    return { status: "missing", missing, declared, message: `Missing: ${missing.join(", ")}.` };
  }

  const unknown = {};
  const sel = selectFeatures(parsed, request);
  if (sel.error) unknown.feature = request;
  const targetName = findName(Object.keys(parsed.targets), target);
  if (!targetName) unknown.target = target;
  // An account is named ("recipe") or selected by a label ("plan=free"). A label
  // that matches exactly one account selects it. One that matches none is not
  // declared. One that matches several is ambiguous, and nothing is guessed.
  const matched = [];
  const badAccounts = [];
  const ambiguous = [];
  for (const a of asked) {
    const sel = /^([^=\s]+)=(.+)$/.exec(a);
    if (sel) {
      const [, key, value] = sel;
      const candidates = Object.entries(parsed.accounts)
        .filter(([, acc]) => String(acc.labels[key.toLowerCase()] ?? "").toLowerCase() === value.trim().toLowerCase())
        .map(([name]) => name);
      if (candidates.length === 1) matched.push(candidates[0]);
      else if (candidates.length === 0) badAccounts.push(a);
      else ambiguous.push({ selector: a, candidates });
    } else {
      const name = findName(Object.keys(parsed.accounts), a);
      if (name) matched.push(name);
      else badAccounts.push(a);
    }
  }
  const accountNames = [...new Set(matched)];
  if (badAccounts.length) unknown.accounts = badAccounts;
  if (Object.keys(unknown).length) {
    const parts = Object.entries(unknown).map(([k, v]) => `${k} ${[].concat(v).map((x) => `"${x}"`).join(", ")}`);
    return { status: "unknown", unknown, declared, message: `Not declared in instructions.md: ${parts.join("; ")}.` };
  }
  if (ambiguous.length) {
    const parts = ambiguous.map((x) => `${x.selector} matches ${x.candidates.join(", ")}`);
    return { status: "ambiguous", ambiguous, declared, message: `More than one account fits: ${parts.join("; ")}. Name the account you want.` };
  }

  const showWindow = headed ?? String(request).trim().toLowerCase() !== "all";
  // An attached browser is one shared browser, so accounts cannot run side by
  // side. They run one at a time and the agent clears sign-in state in between.
  const shared = parsed.setup.browser_mode === "attach";

  const features = sel.features.map((f) => ({ name: f.name, steps: f.steps, expect: f.expect, checks: f.checks }));
  const sessions = accountNames.map((account) => ({
    name: `st${runId}-${slug(account)}`,
    account,
    labels: parsed.accounts[account].labels,
    headed: showWindow,
    clearStateFirst: shared,
    features: features.map((f) => f.name),
  }));

  return {
    status: "ok",
    plan: {
      runId,
      request: { feature: request, words: words ?? "", target: targetName, accounts: accountNames, extras: extras ?? [] },
      target: { name: targetName, url: parsed.targets[targetName] },
      headed: showWindow,
      maxParallel: showWindow || shared ? 1 : parsed.setup.max_parallel,
      setup: parsed.setup,
      features,
      sessions,
      notRun: [],
      issues: [],
      results: [],
      skipped: [],
      repairs,
      startedAt: new Date().toISOString(),
    },
  };
}

async function defaultFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
  return res.status;
}

// A skipped session stays in the plan, with no features and a reason. Its browser
// may already be open (a failed sign-in happens after the open), and cleanup
// closes every session that is listed.
function skipSession(plan, session, reason) {
  for (const f of session.features) plan.notRun.push({ name: `${f} (${session.account})`, reason });
  session.features = [];
  session.skipped = reason;
}

// Checks the browser, desktop control, and that the target answers. A browser or
// desktop-control problem stops the whole run. An unreachable target skips every
// feature, because every feature uses that one target. Sign-in is checked by the
// agent, then recorded with markSignInFailed.
export async function preflight(plan, { fetchStatus = defaultFetch, browserDeps, desktopRun } = {}) {
  const browser = await resolveBrowser(plan.setup, browserDeps);
  if (!browser.ok) return { ok: false, error: browser.error };
  const desktop = checkDesktopControl(plan.setup, desktopRun);
  if (!desktop.ok) return { ok: false, error: desktop.error };

  let up = false;
  try {
    up = (await fetchStatus(plan.target.url)) < 500;
  } catch {
    up = false;
  }
  if (!up) {
    for (const s of plan.sessions) skipSession(plan, s, `target "${plan.target.name}" did not respond`);
  }
  return { ok: true, plan, browser };
}

// Records a failed sign-in as an issue and skips that account's features.
export function markSignInFailed(plan, account, { reason = "sign-in did not succeed", screenshot } = {}) {
  const session = plan.sessions.find((s) => s.account === account);
  if (session && !session.skipped) skipSession(plan, session, `sign-in failed for account "${account}"`);
  plan.issues.push({
    title: `Sign-in failed for account "${account}"`,
    severity: "high",
    feature: "(sign-in)",
    target: plan.target.name,
    account,
    steps: [`Open the ${plan.target.name} sign-in page`, `Sign in as "${account}" with the details in instructions.md`],
    expected: "The account signs in and reaches its signed-in page",
    actual: reason,
    console: [],
    network: [],
    fixSuggestion: "Check that this account exists on this target and that its details in instructions.md are correct.",
    screenshot,
  });
  return plan;
}

// A run that stopped before any browser opened, for example because nobody could
// answer a question. It becomes a failing result so a script notices.
export function buildAbortRun(reason, words = "") {
  return {
    aborted: true,
    request: { feature: "(not started)", words, target: "", accounts: [], extras: [] },
    startedAt: new Date().toISOString(),
    sessions: [],
    features: [],
    notRun: [{ name: "The run", reason }],
    issues: [],
    results: [],
    skipped: [],
    repairs: [],
  };
}

export function stateDir(hostDir) {
  return join(hostDir, TMP_DIR);
}

export function saveState(hostDir, state) {
  mkdirSync(join(stateDir(hostDir), "screens"), { recursive: true });
  writeFileSync(join(stateDir(hostDir), STATE_FILE), JSON.stringify(state, null, 2));
}

export function loadState(hostDir) {
  const file = join(stateDir(hostDir), STATE_FILE);
  if (!existsSync(file)) throw new Error("No run in progress. Start one with: site-tester plan <feature|all> --target <name> --accounts <names>");
  return JSON.parse(readFileSync(file, "utf8"));
}

// Repairs made by `lint --fix` wait here until the next plan picks them up, so
// the report can list them.
export function addRepairs(hostDir, repairs) {
  mkdirSync(stateDir(hostDir), { recursive: true });
  const file = join(stateDir(hostDir), REPAIRS_FILE);
  const all = [...loadRepairs(hostDir), ...repairs];
  writeFileSync(file, JSON.stringify(all, null, 2));
  return all;
}

export function loadRepairs(hostDir) {
  const file = join(stateDir(hostDir), REPAIRS_FILE);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function defaultClose(name) {
  return spawnSync("playwright-cli", [`-s=${name}`, "close"], { stdio: "ignore" });
}

// Closes only the sessions this run opened, then removes the temp folder.
// Safe to run twice, and after an aborted run.
export async function cleanupRun(hostDir, { close = defaultClose } = {}) {
  let names = [];
  try {
    names = loadState(hostDir).sessions.map((s) => s.name);
  } catch {
    // no state file: nothing to close
  }
  await runQueue(names, 4, async (name) => close(name));
  rmSync(stateDir(hostDir), { recursive: true, force: true });
  return { closed: names };
}
