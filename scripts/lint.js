// Plain-words check of instructions.md, and the one mechanical repair.
// No dependencies, no network.
import { parseInstructions } from "./instructions.js";

const hasScheme = (v) => /^https?:\/\//i.test(v);

// localhost, 127.x.x.x, 0.0.0.0, [::1] and *.localhost count as this computer.
export function isLocalAddress(v) {
  return /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|[^/:]+\.localhost)(:\d+)?(\/|$)/i.test(v.trim());
}

export function withScheme(v) {
  return `${isLocalAddress(v) ? "http" : "https"}://${v.trim()}`;
}

const SCHEME_FIX = "Add http:// or https:// in front of it (https:// for a live site, http:// for a site on this computer).";

function fromProblem(p, parsed) {
  switch (p.code) {
    case "setup_value":
      return { level: "error", where: `Setup, "${p.key}"`, problem: `"${p.value}" is not an allowed value.`, fix: `Use ${p.allowed}.` };
    case "unreadable_line":
      return p.section === "Targets"
        ? { level: "error", where: "Targets", problem: `This line is not a target: "${p.line}".`, fix: 'Write each target as "- name: https://address".' }
        : { level: "error", where: "Accounts", problem: `This line is not an account: "${p.line}".`, fix: 'Write each account as "- name: email=... | password=... | plan=...". A sentence or a table in this section is not an account.' };
    case "feature_no_steps":
      return { level: "error", where: `Feature "${p.feature}"`, problem: "It has no steps.", fix: 'Add a "steps:" list that says what to do.' };
    case "feature_no_expect":
      return { level: "error", where: `Feature "${p.feature}"`, problem: "It has no expected results.", fix: 'Add an "expect:" list that says what should happen.' };
    case "duplicate":
      return { level: "error", where: `${p.kind[0].toUpperCase()}${p.kind.slice(1)} "${p.name}"`, problem: `The name "${p.name}" is used more than once.`, fix: `Give each ${p.kind} its own name.` };
    case "ignored_line":
      return {
        level: "warning",
        where: `Feature "${p.feature}"`,
        problem: `The line "${p.line}" is ignored. The target and accounts now come from the /test command.`,
        fix: `Delete the line. Say the target and accounts when you run the test, for example: /test ${p.feature} on beta using the recipe account.`,
      };
    default:
      return null;
  }
}

// Returns { problems: [{ level, where, problem, fix }], parsed }.
// level "error" stops a run. level "warning" does not.
export function lintText(text) {
  const parsed = parseInstructions(text);
  const problems = parsed.problems.map((p) => fromProblem(p, parsed)).filter(Boolean);

  for (const [name, url] of Object.entries(parsed.targets)) {
    if (!hasScheme(url)) {
      problems.push({ level: "error", where: `Target "${name}"`, problem: `The address "${url}" does not start with http:// or https://.`, fix: SCHEME_FIX });
    }
  }
  for (const [name, a] of Object.entries(parsed.accounts)) {
    for (const field of ["email", "password"]) {
      if (!a[field]) {
        problems.push({ level: "error", where: `Account "${name}"`, problem: `It has no ${field}.`, fix: `Add "${field}=..." to the account line.` });
      }
    }
  }
  for (const f of parsed.features) {
    for (const [tName, url] of Object.entries(parsed.targets)) {
      if (f.steps.some((s) => s.includes(url))) {
        problems.push({
          level: "warning",
          where: `Feature "${f.name}"`,
          problem: `A step contains the full address ${url} of target "${tName}".`,
          fix: "Use a path such as /login so the feature works on any target.",
        });
        break;
      }
    }
    if (f.name.toLowerCase() === "share") {
      problems.push({
        level: "warning",
        where: `Feature "${f.name}"`,
        problem: 'The name "share" is reserved: /test share publishes the latest report.',
        fix: "Rename the feature so it can be run by name.",
      });
    }
  }
  return { problems, parsed };
}

export function errorsOf(problems) {
  return problems.filter((p) => p.level === "error");
}

export function formatProblems(problems) {
  const part = (title, list) =>
    list.length ? `${title}\n${list.map((p) => `- ${p.where}: ${p.problem}\n  How to fix: ${p.fix}`).join("\n")}` : "";
  const errors = errorsOf(problems);
  const warnings = problems.filter((p) => p.level === "warning");
  const text = [part("Problems (these stop a run):", errors), part("Warnings (these do not stop a run):", warnings)]
    .filter(Boolean)
    .join("\n\n");
  return text || "No problems found.";
}

// The only repair the agent may make: a target address with no http:// or https://.
// Changes only those lines. Every other byte stays exactly as it was.
// Returns { text, changes: [{ old, new }] }.
export function fixTargetSchemes(text) {
  const lines = text.split("\n");
  const changes = [];
  let inTargets = false;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.+?)\s*\r?$/.exec(lines[i]);
    if (heading) {
      inTargets = /^targets$/i.test(heading[1]);
      continue;
    }
    if (!inTargets) continue;
    const m = /^(\s*[-*]\s+[^:\r\n]+:\s*)(\S+)(\s*\r?)$/.exec(lines[i]);
    if (!m || hasScheme(m[2])) continue;
    const updated = `${m[1]}${withScheme(m[2])}${m[3]}`;
    changes.push({ old: lines[i].replace(/\r$/, ""), new: updated.replace(/\r$/, "") });
    lines[i] = updated;
  }
  return { text: lines.join("\n"), changes };
}
