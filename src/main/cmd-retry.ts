import { buildContainer } from '../composition/container';
import type { Container } from '../composition/container';
import type { CliConfig } from './config';
import { exitCodeFor, processExit } from './exit-codes';

/**
 * Sub-comando `retry`: re-intenta SOLO las filas en `fallidos.json`.
 *   1. Construye el container.
 *   2. Llama `ReintentarFallidosUseCase.execute({ maxPdfs })`.
 *   3. Imprime resumen a stdout.
 *   4. Exit 0 si completo (con o sin re-fallos).
 */
export async function runRetry(config: CliConfig): Promise<void> {
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
    const result = await container.retry.execute({
      maxPdfs: config.maxPdfs,
      log: container.logger,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          pdfsOk: result.pdfsOk,
          pdfsFallidos: result.pdfsFallidos,
          pdfsSaltados: result.pdfsSaltados,
          pdfsDescargados: result.pdfsDescargados,
          pending: result.pending,
          fallidosRestantes: result.fallidos.length,
        },
        null,
        2,
      )}\n`,
    );

    if (result.fallidos.length > 0) {
      container.logger.warn('retry termino con fallidos residuales', {
        count: result.fallidos.length,
      });
    }

    await shutdown(container);
    processExit(0);
  } catch (err) {
    container.logger.error('retry failed', { error: errorMessage(err) });
    await shutdown(container);
    processExit(exitCodeFor(err));
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