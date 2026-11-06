// Run planning, preflight, session cleanup, and run-state helpers. No dependencies.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { selectRun } from "./instructions.js";
import { resolveBrowser, checkDesktopControl } from "./browser.js";

export const TMP_DIR = ".testing-agent/tmp";
export const STATE_FILE = "run.json";

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

// One browser session per account. A single-feature run is visible and runs one
// account at a time so the user can watch. "all" runs headless, in parallel.
export function buildPlan(parsed, request, { headed, runId = Date.now().toString(36) } = {}) {
  const sel = selectRun(parsed, request);
  if (sel.error) return sel;

  const showWindow = headed ?? String(request).trim().toLowerCase() !== "all";
  const byAccount = new Map();
  for (const { feature, accounts } of sel.runs) {
    for (const account of accounts) {
      if (!byAccount.has(account)) byAccount.set(account, []);
      byAccount.get(account).push({
        name: feature.name,
        target: feature.target,
        url: parsed.targets[feature.target],
        steps: feature.steps,
        expect: feature.expect,
        checks: feature.checks,
      });
    }
  }

  // An attached browser is one shared browser, so accounts cannot run side by
  // side. They run one at a time and the agent clears sign-in state in between.
  const shared = parsed.setup.browser_mode === "attach";
  const sessions = [...byAccount].map(([account, features]) => ({
    name: `st${runId}-${slug(account)}`,
    account,
    headed: showWindow,
    clearStateFirst: shared,
    features,
  }));

  return {
    runId,
    request,
    headed: showWindow,
    maxParallel: showWindow || shared ? 1 : parsed.setup.max_parallel,
    setup: parsed.setup,
    sessions,
    notRun: sel.notRun.map((n) => ({ ...n })),
    issues: [],
    results: [],
    skipped: [],
    startedAt: new Date().toISOString(),
  };
}

async function defaultFetch(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
  return res.status;
}

function dropFeatures(plan, match, reason) {
  for (const s of plan.sessions) {
    const keep = [];
    for (const f of s.features) {
      if (match(s, f)) plan.notRun.push({ name: `${f.name} (${s.account})`, reason });
      else keep.push(f);
    }
    s.features = keep;
  }
  plan.sessions = plan.sessions.filter((s) => s.features.length > 0);
}

// Checks the browser, desktop control, and that each target answers. A browser
// or desktop-control problem stops the whole run. An unreachable target skips
// only the features that use it. Sign-in is checked by the agent, then recorded
// with markSignInFailed.
export async function preflight(plan, { fetchStatus = defaultFetch, browserDeps, desktopRun } = {}) {
  const browser = await resolveBrowser(plan.setup, browserDeps);
  if (!browser.ok) return { ok: false, error: browser.error };
  const desktop = checkDesktopControl(plan.setup, desktopRun);
  if (!desktop.ok) return { ok: false, error: desktop.error };

  const urls = new Map();
  for (const s of plan.sessions) for (const f of s.features) urls.set(f.target, f.url);
  const entries = [...urls];
  const statuses = await runQueue(entries, plan.setup.max_parallel, async ([, url]) => {
    try {
      return (await fetchStatus(url)) < 500 ? "up" : "down";
    } catch {
      return "down";
    }
  });
  entries.forEach(([target], i) => {
    if (statuses[i] === "down") {
      dropFeatures(plan, (_s, f) => f.target === target, `target "${target}" did not respond`);
    }
  });
  return { ok: true, plan, browser };
}

// Records a failed sign-in as an issue and skips that account's features.
export function markSignInFailed(plan, account, { reason = "sign-in did not succeed", screenshot } = {}) {
  const session = plan.sessions.find((s) => s.account === account);
  const target = session?.features[0]?.target ?? "(unknown)";
  dropFeatures(plan, (s) => s.account === account, `sign-in failed for account "${account}"`);
  plan.issues.push({
    title: `Sign-in failed for account "${account}"`,
    severity: "high",
    feature: "(sign-in)",
    target,
    account,
    steps: [`Open the ${target} sign-in page`, `Sign in as "${account}" with the details in instructions.md`],
    expected: "The account signs in and reaches its signed-in page",
    actual: reason,
    console: [],
    network: [],
    fixSuggestion: "Check that this account exists on this target and that its details in instructions.md are correct.",
    screenshot,
  });
  return plan;
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
  if (!existsSync(file)) throw new Error("No run in progress. Start one with: site-tester plan <feature|all>");
  return JSON.parse(readFileSync(file, "utf8"));
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
