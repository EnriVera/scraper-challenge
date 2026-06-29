import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunStats, Sector } from '../../domain/entities';
import type { ILogger } from '../../domain/ports';
import { ScrapeTablaUseCase } from './scrape-tabla';
import { DescargarPdfsUseCase } from './descargar-pdfs';

/**
 * Configuracion completa de una corrida del scraper (CLI -> use case).
 */
export interface FullRunConfig {
  readonly runId: string;
  readonly sector: Sector;
  readonly maxPaginas?: number;
  readonly maxPdfs?: number | 'unlimited';
  readonly retriesPerRow?: number;
  readonly dataDir: string;
  readonly startedAt: string;
  readonly viewState?: string;
}

/**
 * Puerto write-only para emitir stats. Lo implementa
 * `JsonStatsRecorder` (en `infrastructure/`) o un fake en tests.
 */
export interface IStatsRecorder {
  record(stats: RunStats, dataDir: string): Promise<void>;
}

/**
 * Implementacion por defecto: escribe `data/json/stats.json`.
 */
export class JsonStatsRecorder implements IStatsRecorder {
  async record(stats: RunStats, dataDir: string): Promise<void> {
    const target = join(dataDir, 'json', 'stats.json');
    await mkdir(join(dataDir, 'json'), { recursive: true });
    await writeFile(target, JSON.stringify(stats, null, 2), 'utf8');
  }
}

/**
 * Caso de uso "ejecucion completa": orquesta `ScrapeTabla` y luego
 * `DescargarPdfs` secuencialmente, emite `RunStats` al final.
 * Ver `design.md §3.1` y `design.md §6`.
 */
export class EjecucionCompletaUseCase {
  constructor(
    private readonly scrape: ScrapeTablaUseCase,
    private readonly download: DescargarPdfsUseCase,
    private readonly stats: IStatsRecorder,
    private readonly log: ILogger,
  ) {}

  async run(cfg: FullRunConfig): Promise<RunStats> {
    this.log.info('run starting', {
      runId: cfg.runId,
      sector: cfg.sector,
      maxPaginas: cfg.maxPaginas,
      maxPdfs: cfg.maxPdfs ?? 'unlimited',
    });

    // Paso 1: scrape (bootstrap + buscar + paginar + persistir grilla).
    const scrapeResult = await this.scrape.execute({
      sector: cfg.sector,
      maxPaginas: cfg.maxPaginas,
      log: this.log,
    });

    this.log.info('scrape finished', {
      paginasProcesadas: scrapeResult.paginasProcesadas,
      totalPaginas: scrapeResult.totalPaginas,
      documentos: scrapeResult.documentos.length,
    });

    // Paso 2: descarga de PDFs sobre los documentos scrapeados.
    // Reconstruimos `DescargarOpts` desde el `download` use case
    // inyectado (que trae todas las deps). Como `DescargarPdfsUseCase`
    // expone `deps` por necesidad para que `ReintentarFallidosUseCase`
    // pueda delegar, podemos reusarlo aqui.
    const downloadDeps = (this.download as unknown as { deps: import('./descargar-pdfs').DescargarOpts }).deps;
    const downloadWithDocs = new DescargarPdfsUseCase({
      ...downloadDeps,
      documentos: scrapeResult.documentos,
      maxPdfs: cfg.maxPdfs ?? 'unlimited',
      retriesPerRow: cfg.retriesPerRow ?? downloadDeps.retriesPerRow ?? 5,
      initialViewState: cfg.viewState,
      log: this.log,
    });
    const downloadResult = await downloadWithDocs.execute();

    // Paso 3: emitir RunStats.
    const finishedAt = new Date().toISOString();
    const stats: RunStats = {
      runId: cfg.runId,
      startedAt: cfg.startedAt,
      finishedAt,
      paginasProcesadas: scrapeResult.paginasProcesadas,
      totalPaginas: scrapeResult.totalPaginas,
      documentosOk: downloadResult.pdfsOk + downloadResult.pdfsSaltados,
      documentosFallidos: downloadResult.pdfsFallidos,
      documentosPendientes: downloadResult.pending,
      pdfsSaltados: downloadResult.pdfsSaltados,
      pdfsDescargados: downloadResult.pdfsDescargados,
      reintentosTotales: 0, // se incrementa cuando el retry layer reporta
    };

    await this.stats.record(stats, cfg.dataDir);
    this.log.info('run finished', { ...stats });
    return stats;
  }
}

/**
 * Re-export para que `composition/container.ts` pueda importar el
 * record por defecto si quiere.
 */
export { DescargarPdfsUseCase } from './descargar-pdfs';
export { ScrapeTablaUseCase } from './scrape-tabla';

/** Helper: usado por `composition` para derivar `runId` determinista. */
export function buildRunId(startedAt: Date): string {
  return startedAt.toISOString().replace(/[:.]/g, '-');
}