// Installer for the site-tester testing agent. No dependencies.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const MIN_NODE_MAJOR = 18;

const POINTER_START = "<!-- site-tester:start -->";
const POINTER_END = "<!-- site-tester:end -->";
const POINTER = `${POINTER_START}
## Site testing

To test the website, ask for \`/test <feature>\` or \`/test all\`.
Follow \`.claude/skills/site-tester/SKILL.md\`. The checks come only from
\`.testing-agent/instructions.md\`.
${POINTER_END}
`;

const IGNORE_LINES = [".testing-agent/reports/", ".testing-agent/tmp/"];

export function assertNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split(".")[0]);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    throw new Error(
      `Node.js ${MIN_NODE_MAJOR} or newer is required (found ${version}). Nothing was changed.`,
    );
  }
}

function defaultRun(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, stdio: "inherit" });
}

function copyDir(from, to, created) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry === ".gitkeep") continue;
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) copyDir(src, dest, created);
    else {
      copyFileSync(src, dest);
      created.push(dest);
    }
  }
}

function upsertPointer(file) {
  const exists = existsSync(file);
  const text = exists ? readFileSync(file, "utf8") : "";
  const start = text.indexOf(POINTER_START);
  const end = text.indexOf(POINTER_END);
  let next;
  if (start !== -1 && end > start) {
    next = text.slice(0, start) + POINTER.trimEnd() + text.slice(end + POINTER_END.length);
  } else {
    const sep = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    next = `${text}${sep}${POINTER}`;
  }
  if (next !== text) writeFileSync(file, next);
  return exists ? "updated" : "created";
}

function ensureIgnoreLines(file) {
  const exists = existsSync(file);
  const text = exists ? readFileSync(file, "utf8") : "";
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !have.has(l));
  if (missing.length === 0) return false;
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${text}${sep}${missing.join("\n")}\n`);
  return true;
}

// Installs the browser tooling. Throws with a clear message on failure.
export function installBrowserTooling(hostDir, run = defaultRun) {
  const have = run("playwright-cli", ["--version"], hostDir);
  if (have.error || have.status !== 0) {
    const r = run("npm", ["install", "-g", "@playwright/cli@latest"], hostDir);
    if (r.error || r.status !== 0) {
      throw new Error("Could not install @playwright/cli (npm install -g @playwright/cli@latest failed).");
    }
  }
  const skills = run("playwright-cli", ["install", "--skills"], hostDir);
  if (skills.error || skills.status !== 0) {
    throw new Error("playwright-cli install --skills failed.");
  }
  const browser = run("playwright-cli", ["install-browser", "chromium"], hostDir);
  if (browser.error || browser.status !== 0) {
    throw new Error("playwright-cli install-browser chromium failed.");
  }
}

// Returns a list of human-readable lines saying what was done.
export function init({
  hostDir,
  packageRoot,
  nodeVersion = process.versions.node,
  run = defaultRun,
  skipBrowser = false,
}) {
  assertNodeVersion(nodeVersion);

  const done = [];
  const agentDir = join(hostDir, ".testing-agent");
  mkdirSync(agentDir, { recursive: true });

  const instructions = join(agentDir, "instructions.md");
  if (existsSync(instructions)) {
    done.push("Kept existing .testing-agent/instructions.md (not overwritten)");
  } else {
    copyFileSync(join(packageRoot, "templates", "instructions.md"), instructions);
    done.push("Created .testing-agent/instructions.md");
  }

  const created = [];
  copyDir(join(packageRoot, "skill"), join(hostDir, ".claude", "skills", "site-tester"), created);
  copyDir(join(packageRoot, "command"), join(hostDir, ".claude", "commands"), created);
  done.push("Installed Claude Code skill (.claude/skills/site-tester) and command (/test)");

  // The skill runs this copy, because npx leaves no command on the PATH.
  const runtime = join(agentDir, "runtime");
  copyDir(join(packageRoot, "bin"), join(runtime, "bin"), created);
  copyDir(join(packageRoot, "scripts"), join(runtime, "scripts"), created);
  copyFileSync(join(packageRoot, "package.json"), join(runtime, "package.json"));
  done.push("Installed the run tools (.testing-agent/runtime)");

  done.push(`${upsertPointer(join(hostDir, "CLAUDE.md")) === "created" ? "Created" : "Updated"} CLAUDE.md pointer`);

  const ignored = ensureIgnoreLines(join(hostDir, ".gitignore"));
  done.push(ignored ? "Added report folders to .gitignore" : ".gitignore already lists report folders");

  if (skipBrowser) {
    done.push("Skipped browser tooling (--skip-browser)");
  } else {
    installBrowserTooling(hostDir, run);
    done.push("Installed playwright-cli, its skills, and Chromium");
  }
  return done;
}
