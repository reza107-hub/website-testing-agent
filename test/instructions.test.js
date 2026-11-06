import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseInstructions, selectRun } from "../scripts/instructions.js";

const templatePath = fileURLToPath(
  new URL("../templates/instructions.md", import.meta.url),
);

const sample = `
## Targets
- local: http://localhost:3000/
- live: https://example.com

## Accounts
- recipe: email=a@example.com | password=pw1 | channel=https://youtube.com/@a
- tech: email=b@example.com | password=pw2

## Feature: search
target: local
steps:
1. Open /search
2. Type a word
expect:
- Results show

## Feature: profile
target: live
accounts: tech
steps:
- Open /profile
expect:
- Name shows
`;

// 2.1 template
test("template parses with no errors and has the credential warning first", () => {
  const text = readFileSync(templatePath, "utf8");
  const parsed = parseInstructions(text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.features.length, 1);
  assert.equal(parsed.features[0].name, "login");
  assert.equal(parsed.features[0].notRun, undefined);
  const firstLines = text.split("\n").slice(0, 6).join("\n");
  assert.match(firstLines, /WARNING/);
  assert.match(firstLines, /private repository/);
});

// 2.2 parser
test("defaults apply when the setup section is missing", () => {
  const { setup } = parseInstructions(sample);
  assert.equal(setup.browser, "chromium");
  assert.equal(setup.browser_mode, "launch");
  assert.equal(setup.desktop_control, false);
});

test("defaults apply when setup omits browser", () => {
  const { setup, errors } = parseInstructions("## Setup\n\ndesktop_control: on\n");
  assert.equal(setup.browser, "chromium");
  assert.equal(setup.desktop_control, true);
  assert.deepEqual(errors, []);
});

test("parses targets, accounts, and features", () => {
  const p = parseInstructions(sample);
  assert.deepEqual(p.targets, { local: "http://localhost:3000", live: "https://example.com" });
  assert.equal(p.accounts.recipe.email, "a@example.com");
  assert.equal(p.accounts.recipe.channel, "https://youtube.com/@a");
  assert.deepEqual(p.features[0].steps, ["Open /search", "Type a word"]);
  assert.deepEqual(p.features[1].accounts, ["tech"]);
  assert.deepEqual(p.errors, []);
});

test("invalid setup values and missing feature fields are reported", () => {
  const p = parseInstructions(`## Setup
browser: netscape
debug_port: abc
desktop_control: maybe

## Feature: empty
target: local
`);
  assert.ok(p.errors.some((e) => /unknown browser "netscape"/.test(e)));
  assert.ok(p.errors.some((e) => /invalid debug_port/.test(e)));
  assert.ok(p.errors.some((e) => /desktop_control must be on or off/.test(e)));
  assert.ok(p.errors.some((e) => /"empty": has no steps/.test(e)));
  assert.ok(p.errors.some((e) => /"empty": has no expect/.test(e)));
  assert.equal(p.setup.browser, "chromium");
});

// 2.3 validation
test("unknown target marks only that feature as not run, with a reason", () => {
  const p = parseInstructions(`${sample}
## Feature: broken
target: nowhere
steps:
- x
expect:
- y
`);
  const broken = p.features.find((f) => f.name === "broken");
  assert.match(broken.notRun, /unknown target "nowhere"/);
  assert.equal(p.features.find((f) => f.name === "search").notRun, undefined);
});

test("unknown account marks that feature as not run, with a reason", () => {
  const p = parseInstructions(`${sample}
## Feature: ghost
target: local
accounts: recipe, nobody
steps:
- x
expect:
- y
`);
  const ghost = p.features.find((f) => f.name === "ghost");
  assert.match(ghost.notRun, /unknown account "nobody"/);
});

test("a single declared target is used when a feature names none", () => {
  const p = parseInstructions(`## Targets
- only: http://x.test

## Feature: f
steps:
- a
expect:
- b
`);
  assert.equal(p.features[0].target, "only");
  assert.equal(p.features[0].notRun, undefined);
});

test("no target set with several targets declared marks the feature not run", () => {
  const p = parseInstructions(`## Targets
- a: http://a.test
- b: http://b.test

## Feature: f
steps:
- a
expect:
- b
`);
  assert.match(p.features[0].notRun, /no target set/);
});

// 2.4 selection
test("selecting a feature by name runs only that feature, case-insensitive", () => {
  const sel = selectRun(parseInstructions(sample), "SEARCH");
  assert.equal(sel.runs.length, 1);
  assert.equal(sel.runs[0].feature.name, "search");
});

test("accounts default to every declared account", () => {
  const sel = selectRun(parseInstructions(sample), "search");
  assert.deepEqual(sel.runs[0].accounts, ["recipe", "tech"]);
});

test("a feature with listed accounts runs only those", () => {
  const sel = selectRun(parseInstructions(sample), "profile");
  assert.deepEqual(sel.runs[0].accounts, ["tech"]);
});

test("all selects every feature", () => {
  const sel = selectRun(parseInstructions(sample), "all");
  assert.deepEqual(sel.runs.map((r) => r.feature.name), ["search", "profile"]);
  assert.deepEqual(sel.notRun, []);
});

test("an unmatched name returns the declared feature names and runs nothing", () => {
  const sel = selectRun(parseInstructions(sample), "checkout");
  assert.ok(sel.error);
  assert.deepEqual(sel.declared, ["search", "profile"]);
  assert.equal(sel.runs, undefined);
});

test("not-run features are reported by the selector, not run", () => {
  const p = parseInstructions(`${sample}
## Feature: broken
target: nowhere
steps:
- x
expect:
- y
`);
  const sel = selectRun(p, "all");
  assert.equal(sel.runs.length, 2);
  assert.equal(sel.notRun.length, 1);
  assert.equal(sel.notRun[0].name, "broken");
});
