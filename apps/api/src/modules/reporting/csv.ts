import type { Cell, ReportColumn } from './report.registry.js';

/**
 * RFC 4180 CSV with a UTF-8 BOM (Excel opens Arabic correctly), CRLF rows, and formula-injection
 * neutralisation: a cell starting with = + - @ is prefixed with a single quote so a spreadsheet
 * never executes it (OWASP CSV injection).
 */
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

function cell(v: Cell): string {
  if (v === null) return '';
  let s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: ReportColumn[], rows: Record<string, Cell>[]): string {
  const header = columns.map((c) => cell(c.labelEn)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c.key] ?? null)).join(','));
  return BOM + [header, ...body].join(CRLF) + CRLF;
}
