import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHROMIUM_CONFIG,
  checkBrowserWindowVisible,
  checkDesktopControl,
  isInstalled,
  resolveBrowser,
} from "../scripts/browser.js";
import { parseInstructions } from "../scripts/instructions.js";

const base = { browser: "chromium", browser_mode: "launch", debug_port: 9222, desktop_control: false };
const yes = () => true;
const no = () => false;
const portUp = async () => true;
const portDown = async () => false;

// 4.1
test("default is bundled chromium, launched with the chromium channel config", async () => {
  const setup = parseInstructions("").setup;
  const r = await resolveBrowser(setup, { isInstalled: no, portResponds: portDown });
  assert.deepEqual(r, { ok: true, open: { browser: null, config: CHROMIUM_CONFIG }, attach: null });
  assert.equal(CHROMIUM_CONFIG.browser.launchOptions.channel, "chromium");
});

test("chrome and msedge launch with their channel when installed", async () => {
  for (const browser of ["chrome", "msedge"]) {
    const r = await resolveBrowser({ ...base, browser }, { isInstalled: yes, portResponds: portDown });
    assert.deepEqual(r, { ok: true, open: { browser, config: null }, attach: null });
  }
});

test("brave attach returns the cdp url for the debug port", async () => {
  const r = await resolveBrowser(
    { ...base, browser: "brave", browser_mode: "attach", debug_port: 9333 },
    { isInstalled: no, portResponds: portUp },
  );
  assert.deepEqual(r, { ok: true, open: null, attach: { cdp: "http://localhost:9333" } });
});

test("brave without attach mode is rejected with guidance", async () => {
  const r = await resolveBrowser({ ...base, browser: "brave" }, { isInstalled: yes, portResponds: portUp });
  assert.equal(r.ok, false);
  assert.match(r.error, /Brave must be used in attach mode/);
});

// 4.2
test("a browser that is not installed stops with its name", async () => {
  const r = await resolveBrowser({ ...base, browser: "msedge" }, { isInstalled: no, portResponds: portUp });
  assert.equal(r.ok, false);
  assert.match(r.error, /Microsoft Edge is not installed/);
});

test("a dead debug port stops with the port number and browser name", async () => {
  const r = await resolveBrowser(
    { ...base, browser: "brave", browser_mode: "attach", debug_port: 9222 },
    { isInstalled: yes, portResponds: portDown },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /debug port 9222/);
  assert.match(r.error, /Brave/);
});

test("installed check uses PATH names on linux and app folders on macOS", () => {
  assert.equal(isInstalled("chrome", "linux", (c) => c === "google-chrome-stable"), true);
  assert.equal(isInstalled("msedge", "linux", () => false), false);
  assert.equal(isInstalled("chrome", "darwin", () => false, (p) => p === "/Applications/Google Chrome.app"), true);
  assert.equal(isInstalled("chrome", "win32", () => false, () => false), true);
});

// 4.4
const status = (state) => () => ({
  status: 0,
  stdout: JSON.stringify({ ok: true, data: { permissions: { accessibility: { state } } } }),
});

test("desktop control is not used and not checked when off", () => {
  let called = false;
  const r = checkDesktopControl(base, () => { called = true; return {}; });
  assert.deepEqual(r, { ok: true, used: false });
  assert.equal(called, false);
});

test("desktop control on with permission granted passes", () => {
  const r = checkDesktopControl({ ...base, desktop_control: true }, status("granted"));
  assert.deepEqual(r, { ok: true, used: true });
});

test("desktop control on with permission missing stops with guidance", () => {
  const r = checkDesktopControl({ ...base, desktop_control: true }, status("denied"), "darwin");
  assert.equal(r.ok, false);
  assert.match(r.error, /accessibility permission is "denied"/);
  assert.match(r.error, /permissions --guide/);
});

test("desktop control on but agent-desktop missing stops with install guidance", () => {
  const r = checkDesktopControl({ ...base, desktop_control: true }, () => ({ error: new Error("ENOENT"), status: null }));
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

test("unreadable agent-desktop status stops instead of guessing", () => {
  const r = checkDesktopControl({ ...base, desktop_control: true }, () => ({ status: 0, stdout: "not json" }));
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be read/);
});

// 4.6
const windows = (list) => () => ({ status: 0, stdout: JSON.stringify({ ok: true, data: list }) });
const on = { ...base, desktop_control: true };

test("window check is skipped when desktop control is off", () => {
  let called = false;
  const r = checkBrowserWindowVisible(base, { pageTitle: "T", run: () => { called = true; return {}; } });
  assert.deepEqual(r, { ok: true, checked: false });
  assert.equal(called, false);
});

test("a visible bundled chromium window passes", () => {
  const r = checkBrowserWindowVisible(on, { pageTitle: "Example Domain", run: windows([{ app_name: "chrome", title: "Example Domain - Google Chrome for Testing", accessible: true }]) });
  assert.deepEqual(r, { ok: true, checked: true });
});

test("an attached brave with no visible window stops and suggests bundled chromium", () => {
  const r = checkBrowserWindowVisible(
    { ...on, browser: "brave", browser_mode: "attach" },
    { pageTitle: "Example Domain", run: windows([{ app_name: "gnome-shell", title: "x", accessible: true }]) },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /cannot see a Brave window/);
  assert.match(r.error, /browser: chromium/);
  assert.match(r.error, /desktop_control: off/);
});

test("a window that is not accessible does not count as visible", () => {
  const r = checkBrowserWindowVisible(on, { pageTitle: "Example Domain", run: windows([{ app_name: "chrome", title: "Example Domain", accessible: false }]) });
  assert.equal(r.ok, false);
});

test("bundled chromium with no window says a visible window is needed", () => {
  const r = checkBrowserWindowVisible(on, { pageTitle: "Example Domain", run: windows([]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs a visible window/);
});

test("an unreadable window list stops instead of guessing", () => {
  const r = checkBrowserWindowVisible(on, { pageTitle: "T", run: () => ({ status: 0, stdout: "nope" }) });
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be read/);
  const r2 = checkBrowserWindowVisible(on, { pageTitle: "T", run: () => ({ error: new Error("ENOENT"), status: null }) });
  assert.equal(r2.ok, false);
});

test("another window of the same browser showing a different page does not count", () => {
  const r = checkBrowserWindowVisible(
    { ...on, browser: "brave", browser_mode: "attach" },
    { pageTitle: "Example Domain", run: windows([{ app_name: "brave", title: "Google Search - Brave", accessible: true }]) },
  );
  assert.equal(r.ok, false);
});

test("a missing page title stops instead of matching any window", () => {
  const r = checkBrowserWindowVisible(on, { run: windows([{ app_name: "chrome", title: "x", accessible: true }]) });
  assert.equal(r.ok, false);
  assert.match(r.error, /no page title/);
});
