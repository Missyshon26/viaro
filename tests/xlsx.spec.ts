import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { writeXlsx } from '../src/jobs/reportExport.job';
import { exportQuerySchema } from '../src/modules/reports/reports.validation';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abl-xlsx-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function readBack(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets[0];
}

describe('Excel report export', () => {
  it('is an accepted export format', () => {
    expect(exportQuerySchema.parse({ format: 'xlsx' }).format).toBe('xlsx');
    expect(exportQuerySchema.safeParse({ format: 'docx' }).success).toBe(false);
  });

  it('writes a header row and one row per record, keeping numbers numeric', async () => {
    const file = path.join(dir, 'trips.xlsx');
    await writeXlsx(
      file,
      'trips-completed',
      [
        { tripId: 'a1', fare: 140.5, driver: 'Sam' },
        { tripId: 'a2', fare: 99, driver: null },
      ],
      { from: '2026-10-01', to: '2026-10-31' },
    );

    const sheet = await readBack(file);
    expect(sheet.getRow(1).values).toEqual([undefined, 'tripId', 'fare', 'driver']);
    expect(sheet.getRow(2).getCell(2).value).toBe(140.5);
    expect(typeof sheet.getRow(2).getCell(2).value).toBe('number');
    expect(sheet.rowCount).toBe(3);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('stores a formula-looking cell as inert text', async () => {
    const file = path.join(dir, 'inject.xlsx');
    await writeXlsx(file, 'cancellations-penalties', [{ reason: '=HYPERLINK("http://evil","x")' }], {});

    const cell = (await readBack(file)).getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://evil","x")');
  });

  it('still produces a valid workbook when there is no data', async () => {
    const file = path.join(dir, 'empty.xlsx');
    await writeXlsx(file, 'earnings-payout', [], { from: '2026-10-01' });

    const sheet = await readBack(file);
    expect(String(sheet.getRow(1).getCell(1).value)).toContain('No data');
  });
});
