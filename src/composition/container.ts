import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import axios, { type AxiosInstance } from 'axios';
import type { ILogger } from '../domain/ports';
import { OefaHttpClient } from '../infrastructure/http/oefa-http-client';
import { OefaGridParser } from '../infrastructure/parser/oefa-grid-parser';
import { OefaPaginatorParser } from '../infrastructure/parser/oefa-paginator-parser';
import { JsFileStorage } from '../infrastructure/storage/js-file-storage';
import { JsonDataStore } from '../infrastructure/storage/json-data-store';
import { ConsoleLogger } from '../infrastructure/logging/console-logger';
import { FileLogger } from '../infrastructure/logging/file-logger';
import { FullJitterBackoff } from '../infrastructure/retry/full-jitter-backoff';
import { PLimitScheduler } from '../infrastructure/retry/plimit-scheduler';
import { BackoffRetryRunner } from '../infrastructure/retry/backoff-retry-runner';
import { OefaPathBuilder } from '../infrastructure/path/path-builder';
import {
  ScrapeTablaUseCase,
  DescargarPdfsUseCase,
  ReintentarFallidosUseCase,
  EjecucionCompletaUseCase,
  JsonStatsRecorder,
} from '../application/use-cases';
import { buildLogPath } from './log-paths';

/**
 * Configuracion que la CLI inyecta al composition root.
 * Ver `design.md §5.2`.
 */
export interface AppConfig {
  readonly sector: import('../domain/entities').Sector;
  readonly maxPaginas?: number;
  readonly maxPdfs: number | 'unlimited';
  readonly retries: number;             // default 5
  readonly concurrency: number;        // forzado a 1 (warn si >1)
  readonly dataDir: string;             // default "data"
  readonly delayBetweenRequestsMs: number; // default 500
  readonly startedAt: Date;
  readonly baseURL?: string;            // default OEFA prod URL
  readonly fixturesDir?: string;        // solo tests
  readonly logger?: ILogger;            // override para tests
}

/**
 * Container que expone los casos de uso ya cableados. La CLI lo consume.
 */
export interface Container {
  readonly scrape: ScrapeTablaUseCase;
  readonly download: DescargarPdfsUseCase;
  readonly retry: ReintentarFallidosUseCase;
  readonly runFull: EjecucionCompletaUseCase;
  readonly logger: ILogger;
  readonly dataDir: string;
  readonly shutdown: () => Promise<void>;
}

/**
 * Composition root. Concreta todas las dependencias: adapters
 * (HTTP, parsers, storage, loggers, retry, scheduler) y casos de uso.
 *
 * Ver `design.md §5.2`.
 *
 * Notas:
 *   - `concurrency` se fuerza a 1; si el caller pasa >1, el logger
 *     emite un warning y se clampea (spec `scraping-oefa §Concurrency
 *     flag above 1 is rejected`).
 *   - El `IScheduler` es UNA sola instancia compartida entre scrape
 *     y download: ambas rutas HTTP pasan por la misma cola `p-limit(1)`
 *     para preservar la invariante de ViewState (spec §Sequential
 *     Pagination Under p-limit(1)).
 */
export async function buildContainer(config: AppConfig): Promise<Container> {
  // 1. Concurrency enforcement.
  const logger = config.logger ?? createTeeLogger(config);
  const concurrency = await enforceConcurrency(config.concurrency, logger);

  // 2. Axios + HTTP client.
  const axiosInstance: AxiosInstance = axios.create({
    baseURL: config.baseURL ?? 'https://publico.oefa.gob.pe',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 60_000,
    responseType: 'arraybuffer',
  });
  const http = new OefaHttpClient({ axios: axiosInstance, log: logger });

  // 3. Parsers.
  const grid = new OefaGridParser();
  const paginator = new OefaPaginatorParser();

  // 4. Storage / Data store.
  const storage = new JsFileStorage();
  const store = new JsonDataStore(config.dataDir, logger);
  await mkdir(join(config.dataDir, 'json'), { recursive: true });
  await mkdir(join(config.dataDir, 'pdfs'), { recursive: true });
  await mkdir(join(config.dataDir, 'logs'), { recursive: true });

  // 5. Retry / Scheduler.
  const backoff = new FullJitterBackoff({ baseMs: 1000, capMs: 60_000 });
  const scheduler = new PLimitScheduler(concurrency);
  const retryRunner = new BackoffRetryRunner();

  // 6. Path builder.
  const pathBuilder = new OefaPathBuilder(config.dataDir);

  // 7. Use cases.
  const scrape = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
  const downloadDeps = {
    documentos: [] as import('../domain/entities').Documento[],
    maxPdfs: config.maxPdfs,
    scheduler,
    http,
    retry: retryRunner,
    backoff,
    storage,
    store,
    log: logger,
    paths: pathBuilder,
    retriesPerRow: config.retries,
  };
  const download = new DescargarPdfsUseCase(downloadDeps);
  const retryUC = new ReintentarFallidosUseCase(downloadDeps);
  const runFull = new EjecucionCompletaUseCase(scrape, download, new JsonStatsRecorder(), logger);

  return {
    scrape,
    download,
    retry: retryUC,
    runFull,
    logger,
    dataDir: config.dataDir,
    shutdown: async () => {
      // Nada que cerrar por ahora (no hay conexiones persistentes).
      // El metodo existe para simetria con containers que tengan DB pool, etc.
    },
  };
}

/**
 * `TeeLogger`: emite cada mensaje a la consola Y al archivo de log
 * de la corrida. Es lo que el operador quiere durante el smoke.
 */
function createTeeLogger(config: AppConfig): ILogger {
  const consoleLogger = new ConsoleLogger();
  const logFilePath = buildLogPath(config.startedAt, config.dataDir);
  const fileLogger = new FileLogger(logFilePath);
  return tee(consoleLogger, fileLogger);
}

function tee(a: ILogger, b: ILogger): ILogger {
  return {
    debug: (msg, ctx) => { a.debug(msg, ctx); b.debug(msg, ctx); },
    info:  (msg, ctx) => { a.info(msg, ctx);  b.info(msg, ctx); },
    warn:  (msg, ctx) => { a.warn(msg, ctx);  b.warn(msg, ctx); },
    error: (msg, ctx) => { a.error(msg, ctx); b.error(msg, ctx); },
  };
}

/**
 * Aplica la politica de concurrency del spec: solo se permite 1; si
 * el caller pide mas, se loguea warning y se clampea.
 */
async function enforceConcurrency(requested: number, logger: ILogger): Promise<number> {
  if (!Number.isInteger(requested) || requested < 1) {
    logger.warn('concurrency invalida, default 1', { requested });
    return 1;
  }
  if (requested > 1) {
    logger.warn('concurrency>1 rechazada por spec, clamp a 1', { requested });
    return 1;
  }
  return requested;
}