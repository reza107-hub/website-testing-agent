import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { init, installBrowserTooling } from "../scripts/install.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("../fixtures/host-project", import.meta.url));

function freshHost() {
  const dir = mkdtempSync(join(tmpdir(), "site-tester-host-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const okRun = () => ({ status: 0 });

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

// 3.1
test("unsupported Node version stops before changing any file", () => {
  const host = freshHost();
  const before = snapshot(host);
  assert.throws(
    () => init({ hostDir: host, packageRoot, nodeVersion: "16.20.0", run: okRun }),
    /Node\.js 18 or newer is required \(found 16\.20\.0\)/,
  );
  assert.deepEqual(snapshot(host), before);
  assert.equal(existsSync(join(host, ".testing-agent")), false);
});

// 3.2
test("install copies instructions, skill, and command into the host project", () => {
  const host = freshHost();
  init({ hostDir: host, packageRoot, run: okRun });
  assert.ok(existsSync(join(host, ".testing-agent", "instructions.md")));
  assert.ok(existsSync(join(host, ".claude", "skills", "site-tester", "SKILL.md")));
  assert.ok(existsSync(join(host, ".claude", "commands", "test.md")));
});

// 3.3
test("re-run keeps a user-edited instructions file and refreshes skill and command", () => {
  const host = freshHost();
  init({ hostDir: host, packageRoot, run: okRun });
  const instr = join(host, ".testing-agent", "instructions.md");
  writeFileSync(instr, "USER EDITED\n");
  writeFileSync(join(host, ".claude", "commands", "test.md"), "STALE\n");
  const lines = init({ hostDir: host, packageRoot, run: okRun });
  assert.equal(readFileSync(instr, "utf8"), "USER EDITED\n");
  assert.notEqual(readFileSync(join(host, ".claude", "commands", "test.md"), "utf8"), "STALE\n");
  assert.ok(lines.some((l) => /not overwritten/.test(l)));
});

// 3.4
test("pointer and ignore entries are added once and not duplicated on re-run", () => {
  const host = freshHost();
  init({ hostDir: host, packageRoot, run: okRun });
  init({ hostDir: host, packageRoot, run: okRun });
  const claude = readFileSync(join(host, "CLAUDE.md"), "utf8");
  assert.equal(claude.split("<!-- site-tester:start -->").length - 1, 1);
  assert.match(claude, /^# Host project fixture/);
  const ignore = readFileSync(join(host, ".gitignore"), "utf8");
  assert.equal(ignore.split(".testing-agent/reports/").length - 1, 1);
  assert.equal(ignore.split(".testing-agent/tmp/").length - 1, 1);
});

test("a missing CLAUDE.md and .gitignore are created", () => {
  const host = mkdtempSync(join(tmpdir(), "site-tester-empty-"));
  init({ hostDir: host, packageRoot, run: okRun });
  assert.match(readFileSync(join(host, "CLAUDE.md"), "utf8"), /\/test all/);
  assert.match(readFileSync(join(host, ".gitignore"), "utf8"), /\.testing-agent\/reports\//);
});

// 3.5 (command sequence; the real download is checked by hand, see tasks)
test("browser tooling runs install --skills then install-browser chromium", () => {
  const calls = [];
  installBrowserTooling("/x", (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    return { status: 0 };
  });
  assert.deepEqual(calls, [
    "playwright-cli --version",
    "playwright-cli install --skills",
    "playwright-cli install-browser chromium",
  ]);
});

test("playwright-cli is installed with npm when it is missing", () => {
  const calls = [];
  installBrowserTooling("/x", (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    return line === "playwright-cli --version" ? { status: 1 } : { status: 0 };
  });
  assert.equal(calls[1], "npm install -g @playwright/cli@latest");
});

test("a failed browser install is reported with a clear message", () => {
  assert.throws(
    () => installBrowserTooling("/x", (cmd, args) => ({ status: args[0] === "install-browser" ? 1 : 0 })),
    /install-browser chromium failed/,
  );
});

test("install copies a runtime that the skill can run with node", () => {
  const host = freshHost();
  init({ hostDir: host, packageRoot, run: okRun });
  const cliPath = join(host, ".testing-agent", "runtime", "bin", "cli.js");
  assert.ok(existsSync(cliPath));
  assert.ok(existsSync(join(host, ".testing-agent", "runtime", "scripts", "report.js")));
  const r = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8", cwd: host });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /plan \[feature\|all\]/);
});
