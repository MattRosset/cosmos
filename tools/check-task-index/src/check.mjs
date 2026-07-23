#!/usr/bin/env node
// Internal consistency of the agent task index (docs/agent-tasks/README.md).
//
// The index is the ONLY place progress is tracked, and agents route off it: rule 1
// says "pick the lowest-numbered `pending` task whose blockers are all `done`". A row
// that lies therefore does not just misinform — it sends an agent to re-implement
// shipped code, or unblocks a lane whose dependency never landed.
//
// This gate checks the table against ITSELF (and against the task files on disk). It
// cannot know whether the code behind a row exists — that is a human/agent judgment —
// so it deliberately checks only what is mechanically decidable:
//   1. every Status is one of the four documented values
//   2. no task is `done` while one of its blockers is not
//   3. every blocker id exists in the table
//   4. every linked task file exists
//   5. no duplicate task ids
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'docs/agent-tasks/README.md');
const VALID_STATUS = new Set(['pending', 'in-progress', 'done', 'blocked']);

let text;
try {
  text = readFileSync(INDEX_PATH, 'utf8');
} catch {
  console.error(`error: could not read ${INDEX_PATH}`);
  process.exit(1);
}

/** A table row: `| [TASK-001](file.md) | title | blocked by | status | notes |`. */
const rows = [];
for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1);
  if (cells.length < 5) continue;
  const idMatch = cells[0].match(/TASK-(\d{3})/);
  if (!idMatch) continue; // header + separator rows
  const linkMatch = cells[0].match(/\]\(([^)]+)\)/);
  rows.push({
    id: idMatch[1],
    file: linkMatch ? linkMatch[1] : null,
    blockedBy: cells[2].trim(),
    status: cells[3].trim().toLowerCase(),
  });
}

if (rows.length === 0) {
  console.error('error: no TASK rows parsed — has the status table format changed?');
  process.exit(1);
}

/**
 * Blocker cells are written for humans, not parsers: `—`, `TASK-018, 020`,
 * `TASK-043–051 (all)` (en dash range), `TASK-009, 010, 012, 013, 014`. Collect every
 * 3-digit id, expanding `NNN–NNN` / `NNN-NNN` ranges.
 */
function parseBlockers(cell) {
  if (!cell || cell === '—' || cell === '-') return [];
  const ids = new Set();
  for (const [, from, to] of cell.matchAll(/(\d{3})\s*[–—-]\s*(\d{3})/g)) {
    for (let n = Number(from); n <= Number(to); n++) ids.add(String(n).padStart(3, '0'));
  }
  for (const [id] of cell.matchAll(/\d{3}/g)) ids.add(id);
  return [...ids];
}

const byId = new Map(rows.map((r) => [r.id, r]));
const errors = [];
const seen = new Set();
const indexDir = dirname(INDEX_PATH);

for (const row of rows) {
  const label = `TASK-${row.id}`;

  if (seen.has(row.id)) errors.push(`${label}: duplicate row`);
  seen.add(row.id);

  if (!VALID_STATUS.has(row.status)) {
    errors.push(`${label}: status "${row.status}" is not one of ${[...VALID_STATUS].join(' | ')}`);
  }

  if (row.file && !existsSync(join(indexDir, row.file))) {
    errors.push(`${label}: linked task file not found — ${row.file}`);
  }

  for (const blockerId of parseBlockers(row.blockedBy)) {
    const blocker = byId.get(blockerId);
    if (!blocker) {
      errors.push(`${label}: blocked by TASK-${blockerId}, which has no row in the table`);
      continue;
    }
    if (row.status === 'done' && blocker.status !== 'done') {
      errors.push(
        `${label}: marked done, but blocker TASK-${blockerId} is "${blocker.status}" — ` +
          `either the blocker landed and its row was never updated, or ${label} is not done`,
      );
    }
  }
}

const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
const summary = Object.entries(counts)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([status, n]) => `${n} ${status}`)
  .join(', ');
console.log(`\nTask index: ${rows.length} tasks (${summary})`);

if (errors.length > 0) {
  console.error(`\nFAIL: ${errors.length} inconsistenc${errors.length === 1 ? 'y' : 'ies'}\n`);
  for (const e of errors) console.error(`  • ${e}`);
  console.error('');
  process.exit(1);
}

console.log('OK: task index is internally consistent\n');
