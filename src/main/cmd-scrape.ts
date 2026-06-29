import { buildContainer } from '../composition/container';
import type { Container } from '../composition/container';
import { buildRunId, type FullRunConfig } from '../application/use-cases';
import type { CliConfig } from './config';
import { formatStats } from './emit-stats';
import { exitCodeFor, processExit } from './exit-codes';

/**
 * Sub-comando `scrape`: ejecuta la pipeline completa.
 *   1. Construye el container con el sector + caps del CLI.
 *   2. Llama `EjecucionCompletaUseCase.run(cfg)`.
 *   3. Imprime `RunStats` final a stdout (JSON).
 *   4. Exit 0 si la corrida completo (con o sin fallidos).
 *
 * Exit codes (per `design.md §6.3`):
 *   0 - success
 *   2 - bootstrap fatal (e.g. ViewStateExpired tras re-bootstrap)
 *   3 - invalid CLI input
 *   4 - MalformedHtmlError
 */
export async function runScrape(config: CliConfig): Promise<void> {
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
    const cfg: FullRunConfig = {
      runId: buildRunId(startedAt),
      sector: config.sector,
      maxPaginas: config.maxPaginas,
      maxPdfs: config.maxPdfs,
      retriesPerRow: config.retries,
      dataDir: config.dataDir,
      startedAt: startedAt.toISOString(),
    };
    const stats = await container.runFull.run(cfg);
    process.stdout.write(`${formatStats(stats, 'json')}\n`);
    await shutdown(container);
    processExit(0);
  } catch (err) {
    container.logger.error('scrape failed', { error: errorMessage(err) });
    await shutdown(container);
    processExit(exitCodeFor(err));
  }
}

async function shutdown(c: Container): Promise<void> {
  try {
    await c.shutdown();
  } catch {
    // ignore shutdown errors
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}