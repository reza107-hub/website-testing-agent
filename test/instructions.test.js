import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredNames, findName, parseInstructions, selectFeatures } from "../scripts/instructions.js";

const sample = `
## Targets
- local: http://localhost:3000/
- live: https://example.com

## Accounts
- recipe: email=a@example.com | password=pw1 | niche=recipe | plan=pro
- free: email=b@example.com | password=pw2 | plan=free

## Feature: search
steps:
1. Open /search
2. Type a word
expect:
- Results show

## Feature: profile
steps:
- Open /profile
expect:
- Name shows
checks:
- no console errors
`;

const codes = (p) => p.problems.map((x) => x.code);

test("defaults apply when the setup section is missing", () => {
  const { setup } = parseInstructions(sample);
  assert.equal(setup.browser, "chromium");
  assert.equal(setup.browser_mode, "launch");
  assert.equal(setup.desktop_control, false);
  assert.equal(setup.max_parallel, 3);
});

test("setup values are read, and bad ones are recorded as problems, not thrown", () => {
  const ok = parseInstructions("## Setup\n\ndesktop_control: on\nmax_parallel: 5\n");
  assert.equal(ok.setup.desktop_control, true);
  assert.equal(ok.setup.max_parallel, 5);
  assert.deepEqual(ok.problems, []);

  const bad = parseInstructions("## Setup\nbrowser: netscape\ndebug_port: abc\ndesktop_control: maybe\nmax_parallel: 0\n");
  assert.deepEqual(bad.problems.map((p) => p.key), ["browser", "debug_port", "desktop_control", "max_parallel"]);
  assert.ok(bad.problems.every((p) => p.code === "setup_value"));
  assert.equal(bad.setup.browser, "chromium");
  assert.equal(bad.setup.max_parallel, 3);
});

test("targets, accounts and features are read; a feature holds only instructions", () => {
  const p = parseInstructions(sample);
  assert.deepEqual(p.targets, { local: "http://localhost:3000", live: "https://example.com" });
  assert.deepEqual(p.features.map((f) => f.name), ["search", "profile"]);
  assert.deepEqual(p.features[0].steps, ["Open /search", "Type a word"]);
  assert.deepEqual(p.features[1].checks, ["no console errors"]);
  assert.equal(p.features[0].target, undefined);
  assert.equal(p.features[0].accounts, undefined);
  assert.deepEqual(p.problems, []);
});

// 1.3
test("account labels are every field except email and password", () => {
  const p = parseInstructions(sample);
  assert.deepEqual(p.accounts.recipe.labels, { niche: "recipe", plan: "pro" });
  assert.deepEqual(p.accounts.free.labels, { plan: "free" });
  assert.equal(p.accounts.free.email, "b@example.com");
  assert.equal(p.accounts.free.password, "pw2");
  assert.ok(!("email" in p.accounts.free.labels) && !("password" in p.accounts.free.labels));
});

// 1.2
test("target and accounts lines inside a feature are ignored and recorded", () => {
  const p = parseInstructions(`${sample}
## Feature: old
target: local
accounts: recipe
steps:
- Open /old
expect:
- Loads
`);
  const f = p.features.find((x) => x.name === "old");
  assert.equal(f.target, undefined);
  assert.deepEqual(f.ignored, ["target: local", "accounts: recipe"]);
  assert.deepEqual(f.steps, ["Open /old"]);
  assert.deepEqual(p.problems.filter((x) => x.code === "ignored_line").map((x) => x.line), ["target: local", "accounts: recipe"]);
  assert.equal(codes(p).includes("feature_no_steps"), false);
});

test("a v1-style file still parses and keeps every step", () => {
  const p = parseInstructions(`## Targets
- local: http://localhost:3000

## Accounts
- main: email=a@x.test | password=1

## Feature: login
target: local
accounts: main
steps:
- Open /login
expect:
- Dashboard opens
`);
  assert.equal(p.features.length, 1);
  assert.deepEqual(p.features[0].steps, ["Open /login"]);
  assert.deepEqual(codes(p), ["ignored_line", "ignored_line"]);
});

test("missing steps and expected results, unreadable lines and duplicates are recorded", () => {
  const p = parseInstructions(`## Targets
- a: http://a.test
- a: http://b.test
- this is not a target

## Accounts
- One account per niche. Use them here.
- x: email=a@x.test | password=1
- x: email=b@x.test | password=2

## Feature: empty

## Feature: Empty
steps:
- s
expect:
- e
`);
  assert.deepEqual(p.targets, { a: "http://a.test" });
  assert.deepEqual(Object.keys(p.accounts), ["x"]);
  const c = codes(p);
  assert.equal(c.filter((x) => x === "unreadable_line").length, 2);
  assert.equal(c.filter((x) => x === "duplicate").length, 3);
  assert.ok(c.includes("feature_no_steps") && c.includes("feature_no_expect"));
});

// selection
test("selecting a feature by name runs only that feature, case-insensitive", () => {
  const sel = selectFeatures(parseInstructions(sample), "SEARCH");
  assert.deepEqual(sel.features.map((f) => f.name), ["search"]);
});

test("all selects every feature", () => {
  assert.deepEqual(selectFeatures(parseInstructions(sample), "all").features.map((f) => f.name), ["search", "profile"]);
});

test("an unmatched name returns the declared feature names and runs nothing", () => {
  const sel = selectFeatures(parseInstructions(sample), "checkout");
  assert.ok(sel.error);
  assert.deepEqual(sel.declared, ["search", "profile"]);
  assert.equal(sel.features, undefined);
});

test("declared names carry account labels for messages that ask the user", () => {
  const d = declaredNames(parseInstructions(sample));
  assert.deepEqual(d.features, ["search", "profile"]);
  assert.deepEqual(d.targets.map((t) => t.name), ["local", "live"]);
  assert.deepEqual(d.accounts, [
    { name: "recipe", labels: { niche: "recipe", plan: "pro" } },
    { name: "free", labels: { plan: "free" } },
  ]);
});

test("findName returns the declared spelling for a case-insensitive match", () => {
  assert.equal(findName(["Beta", "local"], "beta"), "Beta");
  assert.equal(findName(["Beta"], " BETA "), "Beta");
  assert.equal(findName(["Beta"], "prod"), null);
});
