# Browser notes

Findings from testing on one machine: Ubuntu Linux, Wayland, Node 24,
`playwright-cli` and `agent-desktop` 1.1.0, Brave installed as a snap.
Chrome and Edge were not installed, so they are untested.

## Bundled Chromium (default)

- `playwright-cli open` with no `--browser` flag tries the Google Chrome
  channel when the browser is headed, and fails if Chrome is not installed.
  Headless works without a flag, which hides the problem.
- Fix: always open bundled Chromium with `--config` pointing at
  `{"browser":{"browserName":"chromium","launchOptions":{"channel":"chromium"}}}`
  (exported as `CHROMIUM_CONFIG`). Add `--headed` for a visible window.
  Verified headed and headless.

## Brave (attach mode)

- Attach works: start a separate Brave with `--remote-debugging-port=9222
  --user-data-dir=$HOME/brave-qa`, then `playwright-cli attach --cdp=http://localhost:9222`.
  Verified: page opened and snapshot taken.
- Keep the profile folder inside the home directory. Brave is a snap.

## Chrome and Edge

- Not tested. The launch path uses `--browser chrome` / `--browser msedge`.
  Task 4.3 stays open until both are tried on a machine that has them.

## agent-desktop (desktop control)

- With bundled Chromium headed, `agent-desktop list-windows` shows the window as
  `accessible: true` under the app name `chrome`. `agent-desktop snapshot --app chrome -i --compact`
  succeeded (86 element refs). The app name is `chrome`, not `chromium`.
- Brave (snap) results were NOT consistent. In an earlier session, `agent-desktop`
  listed Brave processes but no Brave window, and `snapshot --app brave` failed
  with `WINDOW_NOT_FOUND` ("application left the accessibility bus"), even with
  `--force-renderer-accessibility`. Later, the same kind of Brave (a separate
  profile on a debug port) showed up in `list-windows` as `Example Domain - Brave`
  with `accessible: true`. The cause of the change is unknown. It may depend on
  when the browser starts relative to the accessibility service.
- Because visibility can change, check at run time. The check
  (`checkBrowserWindowVisible`) matches the window by the title of the page the
  run opened. Matching by app name alone is wrong: it passed on the user's own
  Brave window.
- Practical rule: use desktop control with bundled Chromium. Treat Brave as
  unverified until the check passes on the machine.
