import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/cli.js", import.meta.url));

test("--help prints usage and exits 0", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /init \[--skip-browser\]/);
  assert.match(r.stdout, /plan \[feature\|all\]/);
});

test("unknown command exits 1", () => {
  const r = spawnSync(process.execPath, [cli, "nope"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown command: nope/);
});

test("fake host project fixture exists", () => {
  const dir = fileURLToPath(
    new URL("../fixtures/host-project/", import.meta.url),
  );
  assert.ok(existsSync(`${dir}package.json`));
  assert.ok(existsSync(`${dir}CLAUDE.md`));
});
