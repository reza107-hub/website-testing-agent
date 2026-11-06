// Parser and selector for .testing-agent/instructions.md. No dependencies.
//
// The parser never throws on a bad file. It records `problems` (structured, see
// lint.js for the plain-words messages) and keeps going, so one mistake does not
// hide the others.

export const BROWSERS = ["chromium", "chrome", "msedge", "brave"];
export const MODES = ["launch", "attach"];

const DEFAULT_SETUP = {
  browser: "chromium",
  browser_mode: "launch",
  debug_port: 9222,
  desktop_control: false,
  max_parallel: 3,
};

const BLOCK_KEYS = ["steps", "expect", "checks"];
const SIGN_IN_FIELDS = ["email", "password"];

const stripComment = (v) => v.replace(/\s+#\s.*$/, "").trim();
const stripBullet = (l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();

function splitSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      current = { heading: m[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function parseSetup(lines, problems) {
  const setup = { ...DEFAULT_SETUP };
  const bad = (key, value, allowed) => problems.push({ code: "setup_value", key, value, allowed });
  for (const raw of lines) {
    const m = /^\s*([a-z_]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    const value = stripComment(m[2]);
    if (value === "") continue;
    if (key === "browser") {
      if (BROWSERS.includes(value)) setup.browser = value;
      else bad(key, value, BROWSERS.join(", "));
    } else if (key === "browser_mode") {
      if (MODES.includes(value)) setup.browser_mode = value;
      else bad(key, value, MODES.join(", "));
    } else if (key === "debug_port") {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0 && port < 65536) setup.debug_port = port;
      else bad(key, value, "a whole number from 1 to 65535");
    } else if (key === "max_parallel") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= 16) setup.max_parallel = n;
      else bad(key, value, "a whole number from 1 to 16");
    } else if (key === "desktop_control") {
      if (value === "on" || value === "off") setup.desktop_control = value === "on";
      else bad(key, value, "on, off");
    }
  }
  return setup;
}

function parseTargets(lines, problems) {
  const targets = {};
  for (const raw of lines) {
    if (!/^\s*[-*]\s/.test(raw)) continue;
    const m = /^([^:]+):\s*(\S+)$/.exec(stripBullet(raw));
    if (!m) {
      problems.push({ code: "unreadable_line", section: "Targets", line: raw.trim() });
      continue;
    }
    const name = m[1].trim();
    if (name in targets) {
      problems.push({ code: "duplicate", kind: "target", name });
      continue;
    }
    targets[name] = m[2].trim().replace(/\/+$/, "");
  }
  return targets;
}

// An account keeps its sign-in fields and its labels. Every field that is not
// email or password is a label (for example niche or plan).
function parseAccounts(lines, problems) {
  const accounts = {};
  for (const raw of lines) {
    if (!/^\s*[-*]\s/.test(raw)) continue;
    const m = /^([^:]+):\s*(.+)$/.exec(stripBullet(raw));
    if (!m) {
      problems.push({ code: "unreadable_line", section: "Accounts", line: raw.trim() });
      continue;
    }
    const name = m[1].trim();
    if (name in accounts) {
      problems.push({ code: "duplicate", kind: "account", name });
      continue;
    }
    const fields = {};
    for (const part of m[2].split("|")) {
      const kv = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(part);
      if (kv) fields[kv[1]] = kv[2];
    }
    const labels = {};
    for (const [k, v] of Object.entries(fields)) if (!SIGN_IN_FIELDS.includes(k)) labels[k] = v;
    accounts[name] = { ...fields, labels };
  }
  return accounts;
}

function parseFeature(name, lines) {
  const feature = { name, steps: [], expect: [], checks: [], ignored: [] };
  let block = null;
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const m = /^([a-z_]+)\s*:\s*(.*)$/.exec(raw);
    if (m && /^\S/.test(raw)) {
      const key = m[1];
      const value = stripComment(m[2]);
      if (BLOCK_KEYS.includes(key)) {
        block = key;
        if (value) feature[key].push(value);
      } else if (key === "target" || key === "accounts") {
        // v1 lines. The target and accounts now come from the run request.
        block = null;
        feature.ignored.push(raw.trim());
      } else {
        block = null;
      }
    } else if (block) {
      feature[block].push(stripBullet(raw));
    }
  }
  return feature;
}

export function parseInstructions(text) {
  const problems = [];
  let setup = { ...DEFAULT_SETUP };
  let targets = {};
  let accounts = {};
  const features = [];

  for (const section of splitSections(text)) {
    const heading = section.heading;
    const featureMatch = /^Feature:\s*(.+)$/i.exec(heading);
    if (featureMatch) {
      const f = parseFeature(featureMatch[1].trim(), section.lines);
      if (features.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) {
        problems.push({ code: "duplicate", kind: "feature", name: f.name });
      } else {
        features.push(f);
      }
    } else if (/^setup$/i.test(heading)) {
      setup = parseSetup(section.lines, problems);
    } else if (/^targets$/i.test(heading)) {
      targets = parseTargets(section.lines, problems);
    } else if (/^accounts$/i.test(heading)) {
      accounts = parseAccounts(section.lines, problems);
    }
  }

  for (const f of features) {
    if (f.steps.length === 0) problems.push({ code: "feature_no_steps", feature: f.name });
    if (f.expect.length === 0) problems.push({ code: "feature_no_expect", feature: f.name });
    for (const line of f.ignored) problems.push({ code: "ignored_line", feature: f.name, line });
  }

  return { setup, targets, accounts, features, problems };
}

// Declared names, with account labels, for messages that ask the user to choose.
export function declaredNames(parsed) {
  return {
    features: parsed.features.map((f) => f.name),
    targets: Object.entries(parsed.targets).map(([name, url]) => ({ name, url })),
    accounts: Object.entries(parsed.accounts).map(([name, a]) => ({ name, labels: a.labels })),
  };
}

// Case-insensitive lookup that returns the declared spelling, or null.
export function findName(names, wanted) {
  const w = String(wanted).trim().toLowerCase();
  return names.find((n) => n.toLowerCase() === w) ?? null;
}

// request: "all" or a feature name (case-insensitive).
// Returns { features } or { error, declared } when the name matches no declared feature.
export function selectFeatures(parsed, request) {
  const wanted = String(request ?? "").trim().toLowerCase();
  const declared = parsed.features.map((f) => f.name);
  const chosen = wanted === "all" ? parsed.features : parsed.features.filter((f) => f.name.toLowerCase() === wanted);
  if (chosen.length === 0) return { error: `No declared feature matches "${request}"`, declared };
  return { features: chosen };
}
