// Browser resolution and the optional desktop-control check. No dependencies.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const LINUX_BINARIES = {
  chrome: ["google-chrome", "google-chrome-stable", "chrome"],
  msedge: ["microsoft-edge", "microsoft-edge-stable"],
};
const MAC_APPS = {
  chrome: "/Applications/Google Chrome.app",
  msedge: "/Applications/Microsoft Edge.app",
};
const LABEL = { chrome: "Google Chrome", msedge: "Microsoft Edge", brave: "Brave" };

// playwright-cli falls back to the Google Chrome channel when a headed browser
// is opened with no --browser flag, so the bundled Chromium needs this config
// (passed with --config). Verified headed and headless on Linux.
export const CHROMIUM_CONFIG = {
  browser: { browserName: "chromium", launchOptions: { channel: "chromium" } },
};

function onPath(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

// Windows is not checked here: Playwright finds the channel itself and
// reports its own error if the browser is missing.
export function isInstalled(browser, platform = process.platform, which = onPath, exists = existsSync) {
  if (platform === "linux") return LINUX_BINARIES[browser].some(which);
  if (platform === "darwin") return exists(MAC_APPS[browser]);
  return true;
}

export async function portResponds(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// setup comes from parseInstructions().setup.
// Returns { ok: true, open: { browser, config } | null, attach: { cdp } | null }
// or { ok: false, error }. For open: pass --browser <browser> when browser is
// set, and write config to a file for --config when config is set. Headed or
// headless is chosen by the caller with --headed.
export async function resolveBrowser(setup, deps = {}) {
  const installed = deps.isInstalled ?? isInstalled;
  const responds = deps.portResponds ?? portResponds;
  const { browser, browser_mode: mode, debug_port: port } = setup;

  if (mode === "attach") {
    if (!(await responds(port))) {
      const who = LABEL[browser] ?? "the browser";
      return {
        ok: false,
        error: `Cannot attach: nothing answered on debug port ${port}. Start ${who} with --remote-debugging-port=${port} (and a separate --user-data-dir), then run again.`,
      };
    }
    return { ok: true, open: null, attach: { cdp: `http://localhost:${port}` } };
  }

  if (browser === "brave") {
    return {
      ok: false,
      error: "Brave must be used in attach mode. Set browser_mode: attach and start Brave with a debug port.",
    };
  }
  if (browser === "chromium") {
    return { ok: true, open: { browser: null, config: CHROMIUM_CONFIG }, attach: null };
  }
  if (!installed(browser)) {
    return {
      ok: false,
      error: `${LABEL[browser]} is not installed on this machine. Install it, or set browser: chromium.`,
    };
  }
  return { ok: true, open: { browser, config: null }, attach: null };
}

// App names that agent-desktop reports for each browser (Linux, verified for
// chromium and brave). Bundled Chromium reports as "chrome".
const DESKTOP_APP_NAMES = {
  chromium: ["chrome"],
  chrome: ["chrome"],
  msedge: ["msedge", "microsoft-edge"],
  brave: ["brave"],
};

function defaultListWindows() {
  return spawnSync("agent-desktop", ["list-windows"], { encoding: "utf8" });
}

// Confirms agent-desktop can see the window of the page this run opened. Call it
// after the browser is open and visible. pageTitle is the title of the page the
// run is on (from playwright-cli). A window of the same browser that shows some
// other page does not count, so the user's own browser windows cannot give a
// false pass. Returns { ok: true, checked: false } when desktop control is off,
// { ok: true, checked: true } when the window is seen, or { ok: false, error }.
export function checkBrowserWindowVisible(setup, { pageTitle, run = defaultListWindows } = {}) {
  if (!setup.desktop_control) return { ok: true, checked: false };
  if (!pageTitle) {
    return { ok: false, error: "desktop_control is on but no page title was given to find the browser window." };
  }

  const r = run();
  let windows;
  try {
    if (r.error || r.status === null) throw new Error("not run");
    windows = JSON.parse(r.stdout).data;
    if (!Array.isArray(windows)) throw new Error("no window list");
  } catch {
    return {
      ok: false,
      error: "desktop_control is on but the window list could not be read from agent-desktop. Run agent-desktop list-windows and fix what it reports.",
    };
  }

  const names = DESKTOP_APP_NAMES[setup.browser] ?? [];
  const seen = windows.some(
    (w) =>
      names.includes(String(w.app_name).toLowerCase()) &&
      w.accessible !== false &&
      String(w.title).includes(pageTitle),
  );
  if (seen) return { ok: true, checked: true };

  const advice = setup.browser === "chromium"
    ? "Desktop control needs a visible window: run a single feature, which opens a visible browser, or set desktop_control: off."
    : "Desktop control is verified only with the bundled Chromium. Set browser: chromium, or set desktop_control: off.";
  return {
    ok: false,
    error: `desktop_control is on but agent-desktop cannot see a ${LABEL[setup.browser] ?? "Chromium"} window. ${advice}`,
  };
}

function defaultStatusRun() {
  return spawnSync("agent-desktop", ["status"], { encoding: "utf8" });
}

// Returns { ok: true, used: false } when desktop control is off,
// { ok: true, used: true } when permission is granted, or { ok: false, error }.
export function checkDesktopControl(setup, run = defaultStatusRun, platform = process.platform) {
  if (!setup.desktop_control) return { ok: true, used: false };

  const r = run();
  if (r.error || r.status === null) {
    return {
      ok: false,
      error: "desktop_control is on but agent-desktop was not found. Install it (npm install -g agent-desktop) or set desktop_control: off.",
    };
  }

  let state;
  try {
    state = JSON.parse(r.stdout).data.permissions.accessibility.state;
  } catch {
    return {
      ok: false,
      error: "desktop_control is on but agent-desktop status could not be read. Run agent-desktop status and fix what it reports.",
    };
  }

  if (state === "granted" || state === "not_required") return { ok: true, used: true };

  const how = platform === "darwin"
    ? "Run agent-desktop permissions --guide and grant Accessibility to your terminal and browser."
    : "Turn on accessibility support for your desktop session, then run agent-desktop status to confirm.";
  return {
    ok: false,
    error: `desktop_control is on but accessibility permission is "${state}". ${how}`,
  };
}
