# Site Tester Instructions

This is a sanitised copy of the four kinds of mistakes found in the first real pilot file.
It holds no real accounts, addresses or passwords.

## Setup

browser: chromium
browser_mode: launch

## Targets

- local: http://localhost:3000
- production: app.example.com

## Accounts

- One account per niche. Use them to inspect API responses in the network tab (`playwright-cli requests`).

| Niche   | Email            | Password |
| ------- | ---------------- | -------- |
| recipe  | a@example.test   | secret   |

## Feature: login

target: local
accounts: main
steps:
- Open /login
- Sign in
expect:
- The dashboard opens

## Feature: Stepgen

target: productions
accounts: recipe
steps:
- Open /step-gen
expect:
- The page loads
