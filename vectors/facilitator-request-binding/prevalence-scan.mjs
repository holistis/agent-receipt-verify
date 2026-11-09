#!/usr/bin/env node
/**
 * prevalence-scan.mjs -- a mechanical, repeatable count of how often the facilitator-
 * request-binding pattern (x402-foundation/x402#3776, epistemedeus' finding: a fixed/
 * configured resource string stops the facilitator from seeing the request's query
 * string, body, or method) actually shows up in real, independent public @x402/mcp
 * users.
 *
 * WHY THIS EXISTS: an earlier, manual sample (6 repos read by hand) was correctly
 * called an anecdote without a denominator. This script makes the count MECHANICAL
 * and repeatable: no per-repo human judgment, a fixed search query, and an honest
 * denominator (how many of the hits are real, independent users, not x402-foundation
 * itself or a fork of it).
 *
 * LIMITATION, STATED PLAINLY: "fixed resource string" and "has its own binding
 * mechanism" are approximated here with a GREP heuristic (see PATTERN / BINDING_SIGNALS
 * below), not real program analysis. That can produce false positives/negatives; the
 * number is a lower bound on what's mechanically visible in the matched file itself,
 * not legal proof about any individual project. Deliberately does not record or
 * publish individual repository names: it reports counts only.
 *
 * USAGE: node prevalence-scan.mjs [--max-pages=10]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const OUT = "prevalence-scan-results.json";
const QUERY = '"@x402/mcp"';
const EXCLUDED_OWNERS = new Set(["x402-foundation"]);
// The exact pattern from the six manually-read examples: a fixed resource string that
// carries the tool name but no per-call argument.
const FIXED_PATTERN = /resource\s*:\s*\{?\s*url\s*:\s*[`'"]/;
const DYNAMIC_SIGNAL = /resource\s*:\s*[`'"][^`'"]*\$\{\s*(args|input|params|body|req\.)/;
const BINDING_SIGNALS = /(claimId|signClaim|verifyClaim|signMessage|personal_sign|nonce|hash\(|evidenceHash|onAfterSettlement\s*:\s*async[^}]{0,400}(claim|sign|hash))/i;

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function searchAllHits(maxPages) {
  const firstRaw = sh(`gh api -X GET search/code -f q=${JSON.stringify(QUERY)}`);
  const total = JSON.parse(firstRaw).total_count;
  const hits = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    let raw;
    try {
      raw = sh(`gh api -X GET search/code -f q=${JSON.stringify(QUERY)} -f per_page=100 -f page=${page}`);
    } catch (e) {
      console.log(`page ${page}: error (${String(e.message).slice(0, 120)}), stopping pagination here.`);
      break;
    }
    const data = JSON.parse(raw);
    const items = (data.items || []).map((x) => ({ repo: x.repository.full_name, path: x.path, fork: x.repository.fork }));
    if (items.length === 0) break;
    for (const it of items) {
      const key = `${it.repo}::${it.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(it);
    }
    console.log(`page ${page}: ${items.length} rows, ${hits.length} unique (repo, file) pairs so far`);
    await sleep(1500);
  }
  return { total, hits };
}

function realIndependentRepos(hits) {
  const perRepo = new Map();
  for (const h of hits) {
    if (!perRepo.has(h.repo)) perRepo.set(h.repo, { repo: h.repo, fork: h.fork, paths: [] });
    perRepo.get(h.repo).paths.push(h.path);
  }
  const excluded = [];
  const candidates = [];
  for (const r of perRepo.values()) {
    const owner = r.repo.split("/")[0];
    if (EXCLUDED_OWNERS.has(owner)) { excluded.push({ ...r, reason: "owner is x402-foundation itself" }); continue; }
    if (r.fork) { excluded.push({ ...r, reason: "GitHub API marks this as a fork" }); continue; }
    candidates.push(r);
  }
  return { candidates, excluded };
}

function fetchFile(repo, path) {
  try {
    const raw = sh(`gh api "repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}"`);
    const data = JSON.parse(raw);
    if (!data.content) return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

async function assess(candidates) {
  const outcomes = [];
  for (const c of candidates) {
    await sleep(800);
    let fixedPattern = false, dynamic = false, binding = false, unreadable = 0;
    for (const path of c.paths.slice(0, 5)) {
      const content = fetchFile(c.repo, path);
      if (content == null) { unreadable++; continue; }
      if (FIXED_PATTERN.test(content)) fixedPattern = true;
      if (DYNAMIC_SIGNAL.test(content)) dynamic = true;
      if (BINDING_SIGNALS.test(content)) binding = true;
    }
    const verdict = !fixedPattern ? "NO_FIXED_PATTERN_FOUND"
      : dynamic ? "DYNAMIC_RESOURCE_PATTERN_ALSO_PRESENT"
      : binding ? "FIXED_PATTERN_WITH_OWN_BINDING_SIGNAL"
      : "FIXED_PATTERN_NO_VISIBLE_BINDING_SIGNAL";
    outcomes.push({ files_checked: c.paths.slice(0, 5).length, unreadable, verdict });
  }
  return outcomes;
}

async function main() {
  const maxPages = Number((process.argv.find((a) => a.startsWith("--max-pages=")) || "--max-pages=10").split("=")[1]);
  const { total, hits } = await searchAllHits(maxPages);
  const { candidates, excluded } = realIndependentRepos(hits);
  console.log(`\nGitHub reports ${total} total hits for the query ${QUERY}.`);
  console.log(`Fetched in this run: ${hits.length} (repo, file) pairs across ${candidates.length + excluded.length} unique repos.`);
  console.log(`Excluded (x402-foundation itself or a fork of it): ${excluded.length}.`);
  console.log(`Real, independent candidate repos (the denominator of this measurement): ${candidates.length}.\n`);

  const outcomes = await assess(candidates);
  const counts = { NO_FIXED_PATTERN_FOUND: 0, DYNAMIC_RESOURCE_PATTERN_ALSO_PRESENT: 0, FIXED_PATTERN_WITH_OWN_BINDING_SIGNAL: 0, FIXED_PATTERN_NO_VISIBLE_BINDING_SIGNAL: 0 };
  for (const o of outcomes) { counts[o.verdict]++; console.log(o.verdict); }

  const result = {
    measured: new Date().toISOString(),
    search_query: QUERY,
    github_reported_total: total,
    pages_fetched: maxPages,
    unique_repos_seen: candidates.length + excluded.length,
    excluded_not_independent: excluded.length,
    denominator_independent_candidates: candidates.length,
    outcome_counts: counts,
    has_fixed_resource_pattern_total: counts.DYNAMIC_RESOURCE_PATTERN_ALSO_PRESENT + counts.FIXED_PATTERN_WITH_OWN_BINDING_SIGNAL + counts.FIXED_PATTERN_NO_VISIBLE_BINDING_SIGNAL,
    has_fixed_pattern_no_visible_binding: counts.FIXED_PATTERN_NO_VISIBLE_BINDING_SIGNAL,
    limitation: "Grep heuristic on the matched file only, not real program analysis and no multi-file tracing of the binding mechanism; a false negative on binding is more likely than a false positive on the pattern itself. This script deliberately does not record individual repository names in its output.",
  };
  mkdirSync(".", { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nWritten to ${OUT}.`);
  console.log(`RESULT: of ${candidates.length} real, independent @x402/mcp users found in this run, ${result.has_fixed_resource_pattern_total} have the fixed-resource pattern, of which ${result.has_fixed_pattern_no_visible_binding} show no visible own binding signal in the matched file.`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
