import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { processRow } from './convert';
import { writePack, type PackResult } from './write-pack';

/** Read a HYG CSV file and write a star pack to `outDir`. */
export function packFromCsv(inputPath: string, outDir: string): PackResult {
  const csvData = readFileSync(inputPath, 'utf8');
  const rows = parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Record<string, string>[];

  const stars = [];
  for (const row of rows) {
    const star = processRow(row);
    if (star !== null) stars.push(star);
  }
  stars.sort((a, b) => a.id - b.id);
  return writePack(stars, outDir);
}
