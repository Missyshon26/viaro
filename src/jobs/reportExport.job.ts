import fs from 'node:fs';
import path from 'node:path';
import type { Job } from 'bullmq';
import PDFDocument from 'pdfkit';
import { buildWorkbook, toCsv } from '../utils/spreadsheet';
import { getQueue, registerWorker, QUEUE_NAMES } from './queues';
import { runReport, toTabular, type ReportType, type ReportRange } from '../modules/reports/reports.service';
import type { AuthUser } from '../middlewares/authGuard';
import { format, now } from '../config/timezone';
import { logger } from '../utils/logger';

/**
 * Report exports run through BullMQ (spec §4.10) so a large date range never blocks the
 * request — the endpoint returns a job reference and the client polls for the file.
 */
export const REPORT_EXPORT_JOB = 'report-export';
export const EXPORT_DIR = path.resolve(process.cwd(), 'exports');

export interface ReportExportJobData {
  type: ReportType;
  format: 'csv' | 'pdf' | 'xlsx';
  range: ReportRange;
  user: AuthUser;
}

export async function scheduleReportExport(data: ReportExportJobData): Promise<string> {
  const job = await getQueue(QUEUE_NAMES.REPORTS).add(REPORT_EXPORT_JOB, data);
  return String(job.id);
}

export async function getExportStatus(jobId: string) {
  const job = await getQueue(QUEUE_NAMES.REPORTS).getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const file = (job.returnvalue as { file?: string } | undefined)?.file ?? null;
  const owner = (job.data as ReportExportJobData | undefined)?.user ?? null;

  return {
    jobId,
    state,
    /**
     * Absolute server path — for the controller's own use only.
     *
     * It must never be serialised to a client: it disclosed the deployment's directory
     * layout in every status response. The controller strips it and answers with `ready`.
     */
    file,
    ready: Boolean(file),
    /** Who asked for this export, so the controller can refuse everyone else. */
    owner,
    failedReason: job.failedReason ?? null,
  };
}

export function exportFilePath(jobId: string, ext: string): string {
  return path.join(EXPORT_DIR, `${jobId}.${ext}`);
}

async function processExport(job: Job<ReportExportJobData>) {
  const { type, format: fileFormat, range, user } = job.data;

  const result = (await runReport(type, user, range)) as unknown as Record<string, unknown>;
  const rows = toTabular(type, result);

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const file = exportFilePath(String(job.id), fileFormat);

  if (fileFormat === 'csv') {
    fs.writeFileSync(file, toCsv(rows), 'utf8');
  } else if (fileFormat === 'xlsx') {
    await writeXlsx(file, type, rows, range);
  } else {
    await writePdf(file, type, rows, range);
  }

  logger.info(`Report export ${String(job.id)} written to ${file}`);
  return { file, rowCount: rows.length };
}

/** Called once from server.ts during boot. */
export function registerReportWorker(): void {
  registerWorker(QUEUE_NAMES.REPORTS, async (job: Job) => {
    if (job.name === REPORT_EXPORT_JOB) return processExport(job as Job<ReportExportJobData>);
    logger.warn(`Unknown report job '${job.name}'`);
  });
}

/* ------------------------------- formatters ------------------------------- */

export { toCsv };

/** A report as an Excel file; the workbook itself is built by utils/spreadsheet. */
export async function writeXlsx(
  file: string,
  type: ReportType,
  rows: Record<string, unknown>[],
  range: ReportRange,
): Promise<void> {
  const workbook = buildWorkbook(type, rows, `No data for ${range.from ?? 'all time'} → ${range.to ?? 'now'}.`);
  await workbook.xlsx.writeFile(file);
}

async function writePdf(
  file: string,
  type: ReportType,
  rows: Record<string, unknown>[],
  range: ReportRange,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = fs.createWriteStream(file);
    doc.pipe(stream);

    doc.fontSize(18).text(`ABL — ${type}`, { align: 'left' });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(`Generated ${format(now())}`)
      .text(`Range: ${range.from ?? 'all time'} → ${range.to ?? 'now'}`)
      .text(`${rows.length} row(s)`);
    doc.moveDown(0.8).fillColor('#000');

    if (rows.length === 0) {
      doc.fontSize(11).text('No data for this range.');
    } else {
      const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      doc.fontSize(8);
      for (const row of rows) {
        doc.text(headers.map((h) => `${h}: ${row[h] ?? ''}`).join('  |  '), { width: 520 });
        doc.moveDown(0.35);
      }
    }

    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}
