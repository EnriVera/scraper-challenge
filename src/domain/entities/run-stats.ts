/**
 * Resumen de una corrida completa del scraper. Se escribe a
 * `data/json/stats.json` al finalizar y se loguea al final del run.
 */
export interface RunStats {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly paginasProcesadas: number;
  readonly totalPaginas: number | null;
  readonly documentosOk: number;
  readonly documentosFallidos: number;
  readonly documentosPendientes: number;
  readonly pdfsSaltados: number;
  readonly pdfsDescargados: number;
  readonly reintentosTotales: number;
}