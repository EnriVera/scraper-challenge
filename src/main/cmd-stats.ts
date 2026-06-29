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
 *
 * Exit code: **siempre 0**, incluso si `fallidos.json` no esta vacio
 * (eso se reporta como warning).
 */
export async function runStats(config: CliConfig, format: 'json' | 'table' = 'json'): Promise<void> {
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
      await shutdown(container);
      processExit(0);
      return;
    }

    process.stdout.write(`${formatStats(stats, format)}\n`);

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