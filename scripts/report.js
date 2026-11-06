// Issue records, the self-contained HTML report, and the result file.
// This module makes no network calls.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { TMP_DIR } from "./run.js";

export const SEVERITIES = ["low", "medium", "high", "critical"];
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const IMAGE_EXT = new Set(Object.keys(MIME));

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const text = (v) => typeof v === "string" && v.trim() !== "";

// Returns a list of problems. An empty list means the issue is valid.
export function validateIssue(issue) {
  const errors = [];
  for (const f of ["title", "feature", "target", "account", "expected", "actual", "fixSuggestion", "screenshot"]) {
    if (!text(issue?.[f])) errors.push(`missing ${f}`);
  }
  if (!SEVERITIES.includes(issue?.severity)) errors.push(`severity must be one of ${SEVERITIES.join(", ")}`);
  if (!Array.isArray(issue?.steps) || issue.steps.length === 0) errors.push("missing steps");
  for (const f of ["console", "network"]) {
    if (issue?.[f] !== undefined && !Array.isArray(issue[f])) errors.push(`${f} must be a list`);
  }
  const fix = issue?.fixSuggestion;
  if (text(fix)) {
    if (/```|`/.test(fix)) errors.push("fixSuggestion must be plain text with no code");
    const sentences = fix.trim().split(/[.!?]+(?:\s+|$)/).filter(Boolean).length;
    if (sentences > 3) errors.push("fixSuggestion must be one to three sentences");
  }
  return errors;
}

function counts(run) {
  const by = (s) => (run.results ?? []).filter((r) => r.status === s).length;
  // A skip can be recorded twice (a skip note and a skipped result). Count each
  // feature and account pair once.
  const skipped = new Set([
    ...(run.skipped ?? []).map((n) => n.name),
    ...(run.results ?? []).filter((r) => r.status === "skipped").map((r) => `${r.feature} (${r.account})`),
  ]);
  return {
    passed: by("pass"),
    failed: by("fail"),
    skipped: skipped.size,
    notRun: (run.notRun ?? []).length,
    issues: (run.issues ?? []).length,
  };
}

function dataUri(file) {
  if (!existsSync(file)) return null;
  const mime = MIME[extname(file).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
}

function list(items) {
  return items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p class=muted>None</p>";
}

function issueHtml(issue, hostDir) {
  const uri = dataUri(join(hostDir, issue.screenshot));
  const img = uri
    ? `<img alt="Screenshot for ${esc(issue.title)}" src="${uri}">`
    : `<p class=muted>Screenshot file was missing when the report was built.</p>`;
  return `<article class="issue sev-${esc(issue.severity)}">
<h3>${esc(issue.title)} <span class=badge>${esc(issue.severity)}</span></h3>
<p class=muted>${esc(issue.feature)} on ${esc(issue.target)} as ${esc(issue.account)}</p>
<h4>Steps to reproduce</h4><ol>${issue.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<h4>Expected</h4><p>${esc(issue.expected)}</p>
<h4>Actual</h4><p>${esc(issue.actual)}</p>
${issue.console?.length ? `<h4>Console</h4><pre>${esc(issue.console.join("\n"))}</pre>` : ""}
${issue.network?.length ? `<h4>Network</h4><pre>${esc(issue.network.join("\n"))}</pre>` : ""}
<h4>Suggested fix</h4><p>${esc(issue.fixSuggestion)}</p>
${img}
</article>`;
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// The run request as an object, even for runs written by older versions.
function requestOf(run) {
  const r = run.request;
  if (r && typeof r === "object") {
    return { feature: r.feature ?? "", words: r.words ?? "", target: r.target ?? "", accounts: r.accounts ?? [], extras: r.extras ?? [] };
  }
  return { feature: r ?? "", words: "", target: "", accounts: [], extras: [] };
}

// One task per issue (critical first), then one per feature that was not run.
export function buildTasks(run) {
  const issues = (run.issues ?? [])
    .map((issue, i) => ({ issue, i }))
    .sort((x, y) => (SEVERITY_RANK[x.issue.severity] ?? 9) - (SEVERITY_RANK[y.issue.severity] ?? 9) || x.i - y.i)
    .map(({ issue }) => ({
      kind: "issue",
      severity: issue.severity,
      title: issue.title,
      where: `${issue.feature} on ${issue.target} as ${issue.account}`,
      steps: issue.steps,
      expected: issue.expected,
      actual: issue.actual,
      fix: issue.fixSuggestion,
    }));
  const notRun = (run.notRun ?? []).map((n) => ({
    kind: "notrun",
    severity: "not run",
    title: `Find out why this did not run: ${n.name}`,
    where: n.name,
    steps: [],
    expected: "",
    actual: n.reason,
    fix: "Fix the cause, then run the test again.",
  }));
  return [...issues, ...notRun];
}

// Plain text only: no code fences and no inline code marks.
const plain = (v) => String(v ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`/g, "").replace(/\s+/g, " ").trim();

export function buildTasksMd(run, reportFile = "report.html") {
  const tasks = buildTasks(run);
  const lines = ["# Tasks from the test run", "", `Report: ${reportFile}`, ""];
  if (tasks.length === 0) {
    lines.push("There are no tasks. The run found no issues and every feature ran.");
    return `${lines.join("\n")}\n`;
  }
  for (const t of tasks) {
    lines.push(`- [ ] [${t.severity}] ${plain(t.title)} (${plain(t.where)})`);
    if (t.steps.length) lines.push(`  - Steps: ${t.steps.map((s, i) => `${i + 1}. ${plain(s)}`).join(" ")}`);
    if (t.expected) lines.push(`  - Expected: ${plain(t.expected)}`);
    if (t.actual) lines.push(`  - ${t.kind === "issue" ? "Actual" : "Reason"}: ${plain(t.actual)}`);
    lines.push(`  - Suggested fix: ${plain(t.fix)}`);
  }
  return `${lines.join("\n")}\n`;
}

function tasksHtml(run) {
  const tasks = buildTasks(run);
  if (tasks.length === 0) return "<p class=ok>There are no tasks.</p>";
  return `<ol class=tasks>${tasks
    .map(
      (t) =>
        `<li><label><input type="checkbox"> <span class=badge>${esc(t.severity)}</span> <b>${esc(t.title)}</b></label><br><span class=muted>${esc(t.where)}</span><br>${esc(t.kind === "issue" ? t.fix : `${t.actual}. ${t.fix}`)}</li>`,
    )
    .join("")}</ol>`;
}

function requestHtml(run) {
  const r = requestOf(run);
  const features = (run.features ?? []).map((f) => f.name);
  const rows = [
    ["Request", r.words ? `${r.feature} ${r.words}` : r.feature],
    ["Target", r.target],
    ["Accounts", r.accounts.join(", ")],
    ["Features run", features.join(", ")],
  ].filter(([, v]) => v);
  const extras = r.extras.length ? `<p class=muted>Run-only checks: ${esc(r.extras.join("; "))}</p>` : "";
  const repairs = (run.repairs ?? []).length
    ? `<p class=muted>Repairs made to instructions.md: ${esc(run.repairs.map((x) => `${x.what} (${x.old} to ${x.new})`).join("; "))}</p>`
    : "";
  return `<table class=req>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>${extras}${repairs}`;
}

export function buildReportHtml(run, hostDir, c = counts(run)) {
  const groups = new Map();
  for (const i of run.issues ?? []) {
    const key = `${i.feature}\u0000${i.account}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const issuesHtml = groups.size
    ? [...groups].map(([key, items]) => {
        const [feature, account] = key.split("\u0000");
        return `<section><h2>${esc(feature)} <span class=muted>/ ${esc(account)}</span></h2>${items.map((i) => issueHtml(i, hostDir)).join("")}</section>`;
      }).join("\n")
    : "<p class=ok>No issues were found.</p>";

  const rows = (run.results ?? [])
    .map((r) => `<tr><td>${esc(r.feature)}</td><td>${esc(r.account)}</td><td class="st-${esc(r.status)}">${esc(r.status)}</td></tr>`)
    .join("");
  const reasons = (items) => list((items ?? []).map((n) => `${n.name}: ${n.reason}`));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site test report</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:900px;padding:24px;color:#1b1f24}
h1{margin:0 0 4px}.muted{color:#667}.ok{color:#116329;font-weight:600}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.card{border:1px solid #d0d7de;border-radius:8px;padding:10px 16px;min-width:90px}
.card b{display:block;font-size:22px}
.issue{border:1px solid #d0d7de;border-left-width:6px;border-radius:8px;padding:12px 16px;margin:14px 0}
.sev-low{border-left-color:#6e7781}.sev-medium{border-left-color:#bf8700}
.sev-high{border-left-color:#cf222e}.sev-critical{border-left-color:#82071e}
.badge{font-size:12px;border:1px solid #d0d7de;border-radius:10px;padding:1px 8px;vertical-align:middle}
img{max-width:100%;border:1px solid #d0d7de;border-radius:6px;margin-top:8px}
pre{background:#f6f8fa;padding:10px;overflow:auto;border-radius:6px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #d0d7de;padding:6px 8px;text-align:left}
.req th{width:130px;color:#667;font-weight:600}
.tasks{padding-left:20px}.tasks li{margin:10px 0}
.st-pass{color:#116329}.st-fail{color:#cf222e}.st-skipped{color:#bf8700}
</style></head><body>
<h1>Site test report</h1>
<p class=muted>${esc(run.startedAt)} to ${esc(run.finishedAt)} (${esc(run.durationSeconds)} s)</p>
${requestHtml(run)}
<div class="summary">
<div class=card><b>${c.passed}</b>passed</div><div class=card><b>${c.failed}</b>failed</div>
<div class=card><b>${c.skipped}</b>skipped</div><div class=card><b>${c.notRun}</b>not run</div>
<div class=card><b>${c.issues}</b>issues</div></div>
<h2>Tasks</h2>
${tasksHtml(run)}
<h2>Issues</h2>
${issuesHtml}
<h2>Results</h2>
${rows ? `<table><tr><th>Feature</th><th>Account</th><th>Status</th></tr>${rows}</table>` : "<p class=muted>None</p>"}
<h2>Skipped steps</h2>${reasons(run.skipped)}
<h2>Not run</h2>${reasons(run.notRun)}
</body></html>
`;
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Builds report.html and result.json, then deletes every loose screenshot.
export function writeReport(hostDir, run, now = new Date()) {
  for (const issue of run.issues ?? []) {
    const errors = validateIssue(issue);
    if (errors.length) throw new Error(`Issue "${issue?.title ?? "?"}" is not valid: ${errors.join("; ")}`);
  }
  const finished = now;
  const started = new Date(run.startedAt ?? now);
  const full = {
    ...run,
    finishedAt: finished.toISOString(),
    durationSeconds: Math.max(0, Math.round((finished - started) / 1000)),
  };
  const c = counts(full);

  const dir = join(hostDir, ".testing-agent", "reports", stamp(finished));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.html"), buildReportHtml(full, hostDir, c));
  writeFileSync(join(dir, "tasks.md"), buildTasksMd(full));
  const result = {
    // A run is only a pass when nothing was wrong and every feature ran.
    // Skipped steps (for example a payment on a live key) do not fail a run.
    status: c.issues > 0 || c.notRun > 0 ? "fail" : "pass",
    counts: c,
    finishedAt: full.finishedAt,
    durationSeconds: full.durationSeconds,
    report: "report.html",
    tasks: "tasks.md",
    ...(full.aborted ? { reason: full.notRun?.[0]?.reason } : {}),
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));

  const screens = join(hostDir, TMP_DIR, "screens");
  if (existsSync(screens)) {
    for (const f of readdirSync(screens)) {
      if (IMAGE_EXT.has(extname(f).toLowerCase())) rmSync(join(screens, f), { force: true });
    }
  }
  return { dir, result };
}

// Newest result.json under reports/, or null.
export function latestResult(hostDir) {
  const root = join(hostDir, ".testing-agent", "reports");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).sort().reverse();
  for (const d of dirs) {
    const f = join(root, d, "result.json");
    if (existsSync(f)) return { dir: join(root, d), result: JSON.parse(readFileSync(f, "utf8")) };
  }
  return null;
}
