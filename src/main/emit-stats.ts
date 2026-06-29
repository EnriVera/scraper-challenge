import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { RunStats } from '../domain/entities';

/**
 * Emite un resumen legible para stdout a partir de `RunStats`.
 * El formato por default es JSON; `--format table` produce una tabla
 * human-readable (per `design.md §6`).
 */
export function formatStats(stats: RunStats, format: 'json' | 'table' = 'json'): string {
  if (format === 'json') {
    return JSON.stringify(stats, null, 2);
  }
  return formatAsTable(stats);
}

function formatAsTable(stats: RunStats): string {
  const rows: [string, string][] = [
    ['runId', stats.runId],
    ['startedAt', stats.startedAt],
    ['finishedAt', stats.finishedAt ?? '-'],
    ['paginasProcesadas', String(stats.paginasProcesadas)],
    ['totalPaginas', stats.totalPaginas !== null ? String(stats.totalPaginas) : '-'],
    ['documentosOk', String(stats.documentosOk)],
    ['documentosFallidos', String(stats.documentosFallidos)],
    ['documentosPendientes', String(stats.documentosPendientes)],
    ['pdfsSaltados', String(stats.pdfsSaltados)],
    ['pdfsDescargados', String(stats.pdfsDescargados)],
    ['reintentosTotales', String(stats.reintentosTotales)],
  ];
  const labelWidth = Math.max(...rows.map((r) => r[0].length));
  return rows.map(([k, v]) => `${k.padEnd(labelWidth)}  ${v}`).join('\n');
}

/**
 * Lee las stats mas recientes desde disco. Si el archivo no existe,
 * devuelve `null`. NO falla.
 */
export async function readStatsFromDisk(dataDir: string): Promise<RunStats | null> {
  const path = join(dataDir, 'json', 'stats.json');
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as RunStats;
  } catch (err) {
    if (isENOENT(err)) return null;
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}