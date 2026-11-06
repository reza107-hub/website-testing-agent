// Parser and selector for .testing-agent/instructions.md. No dependencies.

const BROWSERS = ["chromium", "chrome", "msedge", "brave"];
const MODES = ["launch", "attach"];

const DEFAULT_SETUP = {
  browser: "chromium",
  browser_mode: "launch",
  debug_port: 9222,
  desktop_control: false,
  max_parallel: 3,
};

const BLOCK_KEYS = ["steps", "expect", "checks"];

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

function parseSetup(lines, errors) {
  const setup = { ...DEFAULT_SETUP };
  for (const raw of lines) {
    const m = /^\s*([a-z_]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    const value = stripComment(m[2]);
    if (value === "") continue;
    if (key === "browser") {
      if (BROWSERS.includes(value)) setup.browser = value;
      else errors.push(`Setup: unknown browser "${value}" (use ${BROWSERS.join(", ")})`);
    } else if (key === "browser_mode") {
      if (MODES.includes(value)) setup.browser_mode = value;
      else errors.push(`Setup: unknown browser_mode "${value}" (use ${MODES.join(", ")})`);
    } else if (key === "debug_port") {
      const port = Number(value);
      if (Number.isInteger(port) && port > 0 && port < 65536) setup.debug_port = port;
      else errors.push(`Setup: invalid debug_port "${value}"`);
    } else if (key === "max_parallel") {
      const n = Number(value);
      if (Number.isInteger(n) && n >= 1 && n <= 16) setup.max_parallel = n;
      else errors.push(`Setup: max_parallel must be a whole number from 1 to 16, got "${value}"`);
    } else if (key === "desktop_control") {
      if (value === "on" || value === "off") setup.desktop_control = value === "on";
      else errors.push(`Setup: desktop_control must be on or off, got "${value}"`);
    }
  }
  return setup;
}

function parseTargets(lines, errors) {
  const targets = {};
  for (const raw of lines) {
    if (!/^\s*[-*]\s/.test(raw)) continue;
    const m = /^([^:]+):\s*(\S+)$/.exec(stripBullet(raw));
    if (!m) {
      errors.push(`Targets: cannot read "${raw.trim()}" (use "- name: https://url")`);
      continue;
    }
    targets[m[1].trim()] = m[2].trim().replace(/\/+$/, "");
  }
  return targets;
}

function parseAccounts(lines, errors) {
  const accounts = {};
  for (const raw of lines) {
    if (!/^\s*[-*]\s/.test(raw)) continue;
    const m = /^([^:]+):\s*(.+)$/.exec(stripBullet(raw));
    if (!m) {
      errors.push(`Accounts: cannot read "${raw.trim()}" (use "- name: email=... | password=...")`);
      continue;
    }
    const fields = {};
    for (const part of m[2].split("|")) {
      const kv = /^\s*([a-z_]+)\s*=\s*(.*?)\s*$/.exec(part);
      if (kv) fields[kv[1]] = kv[2];
    }
    accounts[m[1].trim()] = fields;
  }
  return accounts;
}

function parseFeature(name, lines) {
  const feature = { name, target: null, accounts: null, steps: [], expect: [], checks: [] };
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
      } else if (key === "target") {
        block = null;
        feature.target = value || null;
      } else if (key === "accounts") {
        block = null;
        feature.accounts = value
          ? value.split(",").map((s) => s.trim()).filter(Boolean)
          : null;
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
  const errors = [];
  let setup = { ...DEFAULT_SETUP };
  let targets = {};
  let accounts = {};
  const features = [];

  for (const section of splitSections(text)) {
    const heading = section.heading;
    const featureMatch = /^Feature:\s*(.+)$/i.exec(heading);
    if (featureMatch) {
      features.push(parseFeature(featureMatch[1].trim(), section.lines));
    } else if (/^setup$/i.test(heading)) {
      setup = parseSetup(section.lines, errors);
    } else if (/^targets$/i.test(heading)) {
      targets = parseTargets(section.lines, errors);
    } else if (/^accounts$/i.test(heading)) {
      accounts = parseAccounts(section.lines, errors);
    }
  }

  for (const f of features) {
    if (f.steps.length === 0) errors.push(`Feature "${f.name}": has no steps`);
    if (f.expect.length === 0) errors.push(`Feature "${f.name}": has no expect list`);
  }

  // Resolve targets and accounts. A feature that cannot be resolved is
  // marked notRun with a reason, so one bad name never blocks the others.
  const targetNames = Object.keys(targets);
  const accountNames = Object.keys(accounts);
  for (const f of features) {
    if (f.target === null) {
      if (targetNames.length === 1) f.target = targetNames[0];
      else f.notRun = targetNames.length === 0
        ? "no targets are declared"
        : `no target set (declared: ${targetNames.join(", ")})`;
    } else if (!(f.target in targets)) {
      f.notRun = `unknown target "${f.target}" (declared: ${targetNames.join(", ") || "none"})`;
    }
    if (!f.notRun && f.accounts !== null) {
      const unknown = f.accounts.filter((a) => !(a in accounts));
      if (unknown.length > 0) {
        f.notRun = `unknown account ${unknown.map((a) => `"${a}"`).join(", ")} (declared: ${accountNames.join(", ") || "none"})`;
      }
    }
  }

  return { setup, targets, accounts, features, errors };
}

// request: "all" or a feature name (case-insensitive).
// Returns { runs: [{ feature, accounts }], notRun: [{ name, reason }] }
// or { error, declared } when the name matches no declared feature.
export function selectRun(parsed, request) {
  const declared = parsed.features.map((f) => f.name);
  const wanted = String(request).trim().toLowerCase();
  const chosen = wanted === "all"
    ? parsed.features
    : parsed.features.filter((f) => f.name.toLowerCase() === wanted);

  if (chosen.length === 0) {
    return { error: `No declared feature matches "${request}"`, declared };
  }

  const runs = [];
  const notRun = [];
  for (const feature of chosen) {
    if (feature.notRun) {
      notRun.push({ name: feature.name, reason: feature.notRun });
      continue;
    }
    const accounts = feature.accounts ?? Object.keys(parsed.accounts);
    runs.push({ feature, accounts });
  }
  return { runs, notRun };
}
