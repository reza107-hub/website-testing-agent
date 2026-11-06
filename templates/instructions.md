# Site Tester Instructions

> **WARNING: this file holds test account passwords.**
> Use it only in a private repository, and only with test accounts that
> have no real data or money. Never reuse a real password here. If this
> repository ever becomes public, change every account listed below first.

The testing agent reads only this file. It does not invent features or steps.
Ask Claude Code: `/test <feature name>` for one feature, or `/test all`.

## Setup

browser: chromium        # chromium | chrome | msedge | brave
browser_mode: launch     # launch (own window) | attach (your running browser)
debug_port: 9222         # used only when browser_mode is attach
desktop_control: off     # on = also use agent-desktop for windows outside the page
max_parallel: 3          # most account sessions run at the same time (all runs)

## Targets

- local: http://localhost:3000

## Accounts

- main: email=tester@example.com | password=change-me

## Feature: login

target: local
accounts: main
steps:
- Open /login
- Enter the account email and password, then submit
expect:
- The dashboard page opens
- The account name is visible
checks:
- no console errors
- no failed network requests
