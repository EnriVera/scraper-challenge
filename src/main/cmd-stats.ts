import { buildContainer } from '../composition/container';
import type { Container } from '../composition/container';
import type { CliConfig } from './config';
import { formatStats, readStatsFromDisk } from './emit-stats';
import { processExit } from './exit-codes';

/**
 * Sub-comando `stats`: lee `data/json/stats.json` y/o
 * `data/json/fallidos.json` y emite un resumen a stdout.
 *   - JSON por default (per `design.md §10 issue 4` y brief de PR 4).
 *   - `--format table` cambia a tabla human-readable.
 *   - `--verbose` ademas imprime el breakdown por status leido de
 *     `data/json/documentos.json` (ver
 *     `specs/persistencia-datos §Stats Subcommand Verbose Mode`).
 *
 * Exit code: **siempre 0**, incluso si `fallidos.json` no esta vacio
 * (eso se reporta como warning).
 */
export async function runStats(
  config: CliConfig,
  format: 'json' | 'table' = 'json',
  verbose: boolean = false,
): Promise<void> {
  const startedAt = new Date();
  const container = await buildContainer({
    sector: config.sector,
    maxPaginas: config.maxPaginas,
    maxPdfs: config.maxPdfs,
    retries: config.retries,
    concurrency: config.concurrency,
    dataDir: config.dataDir,
    delayBetweenRequestsMs: config.delayBetweenRequestsMs,
    startedAt,
  });

  try {
    const stats = await readStatsFromDisk(config.dataDir);
    if (stats === null) {
      process.stdout.write(
        `${JSON.stringify({ warning: 'no se encontro data/json/stats.json; el scraper nunca se ejecuto?' })}\n`,
      );
      if (verbose) {
        process.stdout.write(`status=ok: 0\n`);
      }
      await shutdown(container);
      processExit(0);
      return;
    }

    process.stdout.write(`${formatStats(stats, format)}\n`);

    // Modo verbose: emitir breakdown por status leido de documentos.json.
    if (verbose) {
      await emitStatusBreakdown(config.dataDir);
    }

    // Tambien emitimos un warning si hay fallidos pendientes.
    const fallidos = await container.scrape;
    void fallidos; // referencia para el type checker

    const fallidosPath = `${config.dataDir}/json/fallidos.json`;
    try {
      const fs = await import('node:fs/promises');
      const raw = await fs.readFile(fallidosPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        process.stdout.write(
          `\nWarning: hay ${parsed.length} entradas en fallidos.json. Use 'npm run retry' para re-intentar.\n`,
        );
      }
    } catch {
      // Si no existe fallidos.json, no es error.
    }

    await shutdown(container);
    processExit(0);
  } catch (err) {
    container.logger.error('stats failed', { error: errorMessage(err) });
    await shutdown(container);
    processExit(0); // stats SIEMPRE exit 0 (per spec)
  }
}

/**
 * Lee `data/json/documentos.json` y emite, despues del summary, una
 * linea por status con su count, ordenadas alfabeticamente. Si el
 * archivo no existe, emite un unico `status=ok: 0` (spec §missing is safe).
 */
async function emitStatusBreakdown(dataDir: string): Promise<void> {
  const path = `${dataDir}/json/documentos.json`;
  let counts: Record<string, number> = {};
  try {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown[];
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (row && typeof row === 'object' && 'status' in row) {
          const s = String((row as { status: unknown }).status);
          counts[s] = (counts[s] ?? 0) + 1;
        }
      }
    }
  } catch {
    // Archivo faltante o invalido: caemos al single-line `status=ok: 0`.
    counts = { ok: 0 };
  }
  // Si el archivo existe pero esta vacio, igual mostramos `status=ok: 0`
  // para que el output sea consistente con el caso "missing".
  if (Object.keys(counts).length === 0) {
    counts = { ok: 0 };
  }
  const sortedKeys = Object.keys(counts).sort();
  for (const k of sortedKeys) {
    process.stdout.write(`status=${k}: ${counts[k]}\n`);
  }
}

async function shutdown(c: Container): Promise<void> {
  try {
    await c.shutdown();
  } catch {
    // ignore
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}