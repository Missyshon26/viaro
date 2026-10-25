import ExcelJS from 'exceljs';
import { now } from '../config/timezone';

/**
 * Turning rows into a downloadable file, for every export in the system (report exports
 * and the clients list), so they behave the same: same header styling, same protection
 * against spreadsheet formulas in user-typed text.
 */

export type Row = Record<string, unknown>;

/** The columns of a set of rows: the union of their keys, in first-seen order. */
export const columnsOf = (rows: Row[]): string[] => [...new Set(rows.flatMap((r) => Object.keys(r)))];

/**
 * CSV. A cell starting with = + - @ (or a tab/CR before one) is a formula to Excel and
 * Sheets, so a customer who types `=HYPERLINK(...)` into their name would have it run in
 * an operator's spreadsheet. A leading single quote neutralises the cell and stays readable.
 */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';

  const headers = columnsOf(rows);
  const NEUTRALISE = /^[=+\-@\t\r]/;
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    let str = String(value);
    if (NEUTRALISE.test(str)) str = `'${str}`;
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((h) => escape(row[h])).join(','));
  return lines.join('\n');
}

/**
 * An Excel workbook: one sheet, a styled header row that stays put while scrolling, a
 * filter on every column, and widths sized to the content.
 *
 * Numbers stay numbers (so a column can be summed) and everything else is written as
 * text. ExcelJS stores a string as a string, never as a formula, so `=HYPERLINK(...)`
 * shows up as that literal text — the leading-quote guard the CSV needs does not apply.
 */
export function buildWorkbook(sheetName: string, rows: Row[], emptyMessage = 'No data.'): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ABL';
  workbook.created = now().toJSDate();

  // Excel caps sheet names at 31 characters and forbids a few symbols.
  const sheet = workbook.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');

  const headers = columnsOf(rows);
  if (headers.length === 0) {
    sheet.addRow([emptyMessage]);
    return workbook;
  }

  sheet.columns = headers.map((key) => ({ header: key, key }));
  const cell = (value: unknown): string | number | boolean | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return String(value);
  };
  for (const row of rows) sheet.addRow(Object.fromEntries(headers.map((h) => [h, cell(row[h])])));

  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  head.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  sheet.columns.forEach((column, index) => {
    const longest = Math.max(headers[index].length, ...rows.map((r) => String(r[headers[index]] ?? '').length));
    column.width = Math.min(Math.max(longest + 2, 10), 60);
  });

  return workbook;
}

/** The workbook as bytes, for a response body. */
export async function toXlsxBuffer(sheetName: string, rows: Row[], emptyMessage?: string): Promise<Buffer> {
  const workbook = buildWorkbook(sheetName, rows, emptyMessage);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
