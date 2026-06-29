/**
 * Smoke test contra el portal real de OEFA.
 *
 * No usa la CLI como subproceso; instancia el container directamente
 * para que el reporte de errores sea claro y el codigo sea ejecutable
 * desde un solo proceso.
 *
 * Uso:
 *   npm run smoke                          # sector PESQUERIA, 1 pagina, 1 PDF
 *   npm run smoke -- --pages 2 --max-pdfs 5
 *   npm run smoke -- --sector MINERIA --pages 1 --max-pdfs 1
 *
 * Exit codes:
 *   0 - smoke OK (>= 1 documento ok, >= 1 PDF descargado, magic valido)
 *   1 - fallo de smoke (portal caido, magic invalido, etc.)
 *   2 - bootstrap fatal
 *   3 - input invalido
 *   4 - MalformedHtml
 */
import { buildContainer } from '../composition/container';
import { buildRunId } from '../application/use-cases';
import type { Sector } from '../domain/entities';
import { SECTORS_VALIDOS } from '../domain/sector-map';
import { formatStats } from './emit-stats';
import { exitCodeFor, processExit } from './exit-codes';

interface SmokeArgs {
  sector: Sector;
  pages: number;
  maxPdfs: number;
  retries: number;
}

function parseArgs(argv: readonly string[]): SmokeArgs {
  const out: SmokeArgs = {
    sector: 'PESQUERIA',
    pages: 1,
    maxPdfs: 1,
    retries: 5,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--sector': {
        if (!next || !(SECTORS_VALIDOS as readonly string[]).includes(next)) {
          throw new Error(
            `--sector invalido: ${next}. Valores validos: ${SECTORS_VALIDOS.join(', ')}`,
          );
        }
        out.sector = next as Sector;
        i += 1;
        break;
      }
      case '--pages': {
        if (!next) throw new Error('--pages requiere un entero positivo');
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1) throw new Error(`--pages invalido: ${next}`);
        out.pages = n;
        i += 1;
        break;
      }
      case '--max-pdfs': {
        if (!next) throw new Error('--max-pdfs requiere un entero positivo');
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1) throw new Error(`--max-pdfs invalido: ${next}`);
        out.maxPdfs = n;
        i += 1;
        break;
      }
      case '--retries': {
        if (!next) throw new Error('--retries requiere un entero positivo');
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1) throw new Error(`--retries invalido: ${next}`);
        out.retries = n;
        i += 1;
        break;
      }
      default:
        throw new Error(`flag desconocido: ${arg}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  process.stdout.write(
    `[smoke] sector=${args.sector} pages=${args.pages} maxPdfs=${args.maxPdfs} retries=${args.retries}\n`,
  );

  const container = await buildContainer({
    sector: args.sector,
    maxPaginas: args.pages,
    maxPdfs: args.maxPdfs,
    retries: args.retries,
    concurrency: 1,
    dataDir: 'data',
    delayBetweenRequestsMs: 0,
    startedAt,
  });

  try {
    const stats = await container.runFull.run({
      runId: buildRunId(startedAt),
      sector: args.sector,
      maxPaginas: args.pages,
      maxPdfs: args.maxPdfs,
      retriesPerRow: args.retries,
      dataDir: 'data',
      startedAt: startedAt.toISOString(),
    });

    process.stdout.write(`[smoke] stats:\n${formatStats(stats, 'json')}\n`);

    // Validaciones del smoke.
    if (stats.documentosOk < 1) {
      process.stdout.write('[smoke] FAIL: 0 documentos ok (portal caido o 429 sostenido)\n');
      await container.shutdown();
      processExit(1);
      return;
    }
    if (stats.pdfsDescargados < 1) {
      process.stdout.write('[smoke] FAIL: 0 PDFs descargados\n');
      await container.shutdown();
      processExit(1);
      return;
    }

    process.stdout.write('[smoke] OK\n');
    await container.shutdown();
    processExit(0);
  } catch (err) {
    container.logger.error('smoke failed', { error: String(err) });
    await container.shutdown();
    processExit(exitCodeFor(err));
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`[smoke] fatal: ${String(err)}\n`);
  processExit(1);
});