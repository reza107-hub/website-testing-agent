import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { errorsOf, fixTargetSchemes, formatProblems, isLocalAddress, lintText, withScheme } from "../scripts/lint.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const cli = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

const good = `## Targets
- local: http://localhost:3000

## Accounts
- main: email=a@x.test | password=pw

## Feature: login
steps:
- Open /login
expect:
- Dashboard opens
`;

const find = (problems, where, text) => problems.find((p) => p.where.includes(where) && p.problem.includes(text));

// 1.4
test("the shipped template has no problems and no warnings", () => {
  const { problems } = lintText(read("../templates/instructions.md"));
  assert.deepEqual(problems, []);
});

test("a good file has no problems", () => {
  assert.deepEqual(lintText(good).problems, []);
  assert.equal(formatProblems([]), "No problems found.");
});

// 2.1 one test per rule: the message names the place and the fix
test("target without a web scheme", () => {
  const { problems } = lintText(good.replace("http://localhost:3000", "app.example.com"));
  const p = find(problems, 'Target "local"', "app.example.com");
  assert.equal(p.level, "error");
  assert.match(p.problem, /does not start with http:\/\/ or https:\/\//);
  assert.match(p.fix, /Add http:\/\/ or https:\/\//);
});

test("feature without steps, and without expected results", () => {
  const { problems } = lintText(`${good}\n## Feature: bare\n`);
  assert.equal(find(problems, 'Feature "bare"', "no steps").level, "error");
  assert.match(find(problems, 'Feature "bare"', "no steps").fix, /steps:/);
  assert.match(find(problems, 'Feature "bare"', "no expected results").fix, /expect:/);
});

test("account without an email or a password", () => {
  const { problems } = lintText(good.replace("email=a@x.test | ", ""));
  const p = find(problems, 'Account "main"', "no email");
  assert.equal(p.level, "error");
  assert.match(p.fix, /email=/);
  const q = lintText(good.replace(" | password=pw", "")).problems;
  assert.ok(find(q, 'Account "main"', "no password"));
});

test("duplicate names", () => {
  const { problems } = lintText(`${good}\n## Feature: login\nsteps:\n- x\nexpect:\n- y\n`);
  const p = find(problems, 'Feature "login"', "more than once");
  assert.equal(p.level, "error");
  assert.match(p.fix, /own name/);
});

test("setup value not allowed lists the allowed values", () => {
  const { problems } = lintText(`## Setup\nbrowser: netscape\n${good}`);
  const p = find(problems, 'Setup, "browser"', '"netscape"');
  assert.equal(p.level, "error");
  assert.match(p.fix, /chromium, chrome, msedge, brave/);
});

test("a sentence or table in the accounts list is explained, not shown as a parser error", () => {
  const { problems } = lintText(good.replace("## Accounts\n", "## Accounts\n- Use one account per niche here.\n"));
  const p = find(problems, "Accounts", "not an account");
  assert.match(p.fix, /email=\.\.\. \| password=\.\.\./);
  assert.doesNotMatch(JSON.stringify(problems), /cannot read|regex|parse/i);
});

// 2.2 warnings do not stop a run
test("warnings: old feature lines, a hard-coded address, a reserved name", () => {
  const text = `${good}
## Feature: share
target: local
steps:
- Open http://localhost:3000/login
expect:
- Loads
`;
  const { problems } = lintText(text);
  assert.deepEqual(errorsOf(problems), []);
  const old = find(problems, 'Feature "share"', "target: local");
  assert.equal(old.level, "warning");
  assert.match(old.fix, /\/test share on beta/);
  assert.equal(find(problems, 'Feature "share"', "full address").level, "warning");
  assert.match(find(problems, 'Feature "share"', "full address").fix, /\/login/);
  assert.equal(find(problems, 'Feature "share"', "reserved").level, "warning");
  assert.match(formatProblems(problems), /Warnings \(these do not stop a run\)/);
  assert.doesNotMatch(formatProblems(problems), /Problems \(these stop a run\)/);
});

// 2.5 the four problems found in the real pilot file, sanitised
test("the pilot fixture lists each of its four problems in plain words", () => {
  const { problems } = lintText(read("../fixtures/pilot-problems.md"));
  const text = formatProblems(problems);
  assert.ok(find(problems, "Accounts", "not an account"), "the copied sentence");
  assert.ok(find(problems, 'Target "production"', "app.example.com"), "the address with no scheme");
  assert.ok(find(problems, 'Feature "login"', "target: local"), "the old target line");
  assert.ok(find(problems, 'Feature "Stepgen"', "target: productions"), "the old mistyped target line");
  assert.equal(errorsOf(problems).length, 2, "the copied sentence and the address with no scheme stop a run");
  assert.equal(problems.filter((p) => p.level === "warning").length, 4, "two old lines in each of the two features");
  assert.match(text, /Problems \(these stop a run\)/);
  assert.match(text, /How to fix:/);
});

// 2.3 the one repair
test("addresses on this computer get http:// and every other address gets https://", () => {
  assert.equal(isLocalAddress("localhost:3000"), true);
  assert.equal(isLocalAddress("127.0.0.1:8080/x"), true);
  assert.equal(isLocalAddress("[::1]:3000"), true);
  assert.equal(isLocalAddress("app.localhost"), true);
  assert.equal(isLocalAddress("example.com"), false);
  assert.equal(isLocalAddress("localhost.example.com"), false);
  assert.equal(withScheme("localhost:3000"), "http://localhost:3000");
  assert.equal(withScheme("beta2.example.com"), "https://beta2.example.com");
});

test("fix changes only the address line; every other byte, passwords included, is identical", () => {
  const before = `# Title\r\n\r\n## Targets\r\n- local: localhost:3000\r\n- live: beta2.example.com\r\n- ok: https://ok.example.com\r\n\r\n## Accounts\r\n- main: email=a@x.test | password=p@ss:w0rd\r\n\r\n## Feature: f\r\nsteps:\r\n- Open localhost:3000/x\r\nexpect:\r\n- e\r\n`;
  const { text, changes } = fixTargetSchemes(before);
  assert.deepEqual(changes, [
    { old: "- local: localhost:3000", new: "- local: http://localhost:3000" },
    { old: "- live: beta2.example.com", new: "- live: https://beta2.example.com" },
  ]);
  const a = before.split("\n");
  const b = text.split("\n");
  assert.equal(a.length, b.length);
  const differing = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(differing, [3, 4]);
  assert.match(b[3], /\r$/, "line endings are kept");
  assert.ok(text.includes("password=p@ss:w0rd"));
  assert.ok(text.includes("- Open localhost:3000/x"), "steps are never touched");
});

test("a second fix changes nothing", () => {
  const once = fixTargetSchemes("## Targets\n- a: example.com\n").text;
  const twice = fixTargetSchemes(once);
  assert.equal(twice.text, once);
  assert.deepEqual(twice.changes, []);
});

test("addresses outside the Targets section are never changed", () => {
  const t = "## Accounts\n- a: email=x@y.test | password=1\n\n## Feature: f\nsteps:\n- b: example.com\n";
  assert.equal(fixTargetSchemes(t).text, t);
});

function host(text) {
  const dir = mkdtempSync(join(tmpdir(), "st-lint-"));
  mkdirSync(join(dir, ".testing-agent"), { recursive: true });
  writeFileSync(join(dir, ".testing-agent", "instructions.md"), text);
  return dir;
}
const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli", SITE_TESTER_UNATTENDED: "" } });

test("lint command: exit 0 for warnings only, exit 2 for problems, --fix repairs and records it", () => {
  const warnOnly = host(`${good}\n## Feature: old\ntarget: local\nsteps:\n- x\nexpect:\n- y\n`);
  const w = run(warnOnly, "lint");
  assert.equal(w.status, 0);
  assert.match(w.stdout, /is ignored/);

  const bad = host(good.replace("http://localhost:3000", "localhost:3000"));
  const l = run(bad, "lint");
  assert.equal(l.status, 2);
  assert.match(l.stdout, /does not start with http/);

  const fx = run(bad, "lint", "--fix");
  assert.equal(fx.status, 0, fx.stderr);
  assert.match(fx.stdout, /to: - local: http:\/\/localhost:3000/);
  assert.ok(readFileSync(join(bad, ".testing-agent", "instructions.md"), "utf8").includes("- local: http://localhost:3000"));
  const repairs = JSON.parse(readFileSync(join(bad, ".testing-agent", "tmp", "repairs.json"), "utf8"));
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].old, "- local: localhost:3000");

  const again = run(bad, "lint", "--fix");
  assert.match(again.stdout, /Nothing to repair/);
  assert.equal(JSON.parse(readFileSync(join(bad, ".testing-agent", "tmp", "repairs.json"), "utf8")).length, 1);
});

// 2.4
test("plan stops with exit 2 on a problem, in plain words, and opens nothing", () => {
  const h = host(good.replace("http://localhost:3000", "localhost:3000"));
  const r = run(h, "plan", "login", "--target", "local", "--accounts", "main");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /did not start/);
  assert.match(r.stderr, /does not start with http:\/\/ or https:\/\//);
  assert.equal(r.stdout, "");
  assert.throws(() => readFileSync(join(h, ".testing-agent", "tmp", "run.json")), /ENOENT/);
});
