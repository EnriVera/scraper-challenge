import pLimit from 'p-limit';
import type { IScheduler } from '../../domain/ports';

/**
 * Wrapper sobre `p-limit(N)` que satisface `IScheduler`. Mantiene la
 * concurrencia acotada al parametro del constructor.
 *
 * Caso de uso canonico en este scraper: `new PLimitScheduler(1)`.
 * Justificacion (specs/scraping-oefa §Sequential Pagination Under p-limit(1)):
 * el `ViewState` JSF muta por request, asi que dos requests concurrentes
 * invalidarian respuestas. Usamos concurrency=1 para serializar TODAS
 * las llamadas HTTP (paginacion + descarga).
 *
 * Tests PR 4 / smoke validan que el cap=1 se respeta bajo carga.
 */
export class PLimitScheduler implements IScheduler {
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(
        `PLimitScheduler: concurrency must be a positive integer, got ${concurrency}`,
      );
    }
    this.limit = pLimit(concurrency);
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.limit(fn);
  }
}