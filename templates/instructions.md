# Site Tester Instructions

> **WARNING: this file holds test account passwords.**
> Use it only in a private repository, and only with test accounts that
> have no real data or money. Never reuse a real password here. If this
> repository ever becomes public, change every account listed below first.

This file says what to check. It does not say where or with which account.
You say that when you run the test, in plain words:

- `/test login on local using the main account`
- `/test all on local using the main account and the free account`

If you leave out the target or the accounts, the agent asks. Features use paths
such as `/login`, so the same feature works on any target.

To check that this file is written correctly, run:
`node .testing-agent/runtime/bin/cli.js lint`

## Setup

browser: chromium        # chromium | chrome | msedge | brave
browser_mode: launch     # launch (own window) | attach (your running browser)
debug_port: 9222         # used only when browser_mode is attach
desktop_control: off     # on = also check that agent-desktop can see the browser window
max_parallel: 3          # most account sessions run at the same time (all runs)

## Targets

- local: http://localhost:3000

## Accounts

- main: email=tester@example.com | password=change-me | plan=pro

## Feature: login

steps:
- Open /login
- Enter the account email and password, then submit
expect:
- The dashboard page opens
- The account name is visible
checks:
- no console errors
- no failed network requests
