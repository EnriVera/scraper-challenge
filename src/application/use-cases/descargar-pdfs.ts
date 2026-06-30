import type {
  Documento,
  DocumentoPersistido,
  Fallido,
  EstadoDocumento,
} from '../../domain/entities';
import type {
  IBackoff,
  IDataStore,
  IFileStorage,
  IHttpClient,
  ILogger,
  IPathBuilder,
  IRetryRunner,
  IScheduler,
} from '../../domain/ports';
import {
  RateLimitedError,
  TransientHttpError,
  MagicBytesError,
} from '../../domain/errors';

/** Magic bytes de un PDF: `%PDF` (`0x25 0x50 0x44 0x46`). */
export const PDF_MAGIC: readonly number[] = [0x25, 0x50, 0x44, 0x46];

/**
 * Tamano minimo (referencia para documentacion) del archivo existente
 * para considerarlo valido sin re-descargar (ver
 * `specs/descarga-pdfs §Valid existing PDF is skipped`). El tamano
 * minimo es 1000 bytes; el chequeo concreto vive en el test del
 * caso de uso (`tests/unit/application/use-cases/descargar-pdfs.spec.ts`).
 */

/**
 * Opciones del caso de uso `DescargarPdfsUseCase`. El caso de uso
 * NO construye adapters: recibe todo por DI (ver `design.md §3.1`).
 */
export interface DescargarOpts {
  readonly documentos: Documento[];
  /** `undefined` o `'unlimited'` = sin tope; un entero = cap. */
  readonly maxPdfs?: number | 'unlimited';
  readonly scheduler: IScheduler;
  readonly http: IHttpClient;
  readonly retry: IRetryRunner;
  readonly backoff: IBackoff;
  readonly storage: IFileStorage;
  readonly store: IDataStore;
  readonly log: ILogger;
  readonly paths: IPathBuilder;
  /** Budget por-request: numero total de intentos (default 5). */
  readonly retriesPerRow?: number;
  /** ViewState actual de la sesion; se rota en cada respuesta. */
  readonly initialViewState?: string;
}

/**
 * Resultado agregado de una corrida de descarga.
 */
export interface DescargarResult {
  readonly pdfsOk: number;
  readonly pdfsFallidos: number;
  readonly pdfsSaltados: number;
  readonly pdfsDescargados: number;
  readonly pending: number;
  readonly fallidos: Fallido[];
}

/**
 * Caso de uso: descargar PDFs de un lote de `Documento`s.
 * Pipeline por fila (ver `design.md §3.4`):
 *   1. Derivar `path` via `IPathBuilder`.
 *   2. Si existe el archivo y los primeros 4 bytes son `%PDF` y
 *      `size >= MIN_VALID_PDF_SIZE` -> skip (cuenta como saltado).
 *   3. Si existe pero esta corrupto -> delete + re-descargar
 *      (cuenta contra budget).
 *   4. Si budget agotado -> `pending++` y continue.
 *   5. POST descarga via `scheduler.schedule(...)`, envuelto en
 *      `retry.run(...)` (max `retriesPerRow` intentos, jitter full).
 *   6. Validar magic bytes; si falla -> delete partial +
 *      `fallido.magic_bytes_invalidos`.
 *   7. Si exitoso -> `store.updateDocumentoStatus({status:'ok', pdfPath})`
 *      + `store.removeFallido(...)`.
 *
 * El scheduler serializa las requests (incluyendo reintentos) para
 * mantener `p-limit(1)` (ver `specs/manejo-rate-limit §Sequential Retry
 * Across Rows`).
 */
export class DescargarPdfsUseCase {
  constructor(private readonly deps: DescargarOpts) {}

  async execute(): Promise<DescargarResult> {
    const { documentos, log } = this.deps;
    const maxPdfs = this.deps.maxPdfs ?? 'unlimited';
    const retriesPerRow = this.deps.retriesPerRow ?? 5;
    let pdfsOk = 0;
    let pdfsFallidos = 0;
    let pdfsSaltados = 0;
    let pdfsDescargados = 0;
    let pending = 0;
    let attemptsUsed = 0;
    const collectedFallidos: Fallido[] = [];

    for (const row of documentos) {
      const archivo = row.archivo;

      // Fila sin link de archivo: no se puede descargar. Se anota
      // como `archivo_no_disponible` en `fallidos.json` (spec
      // `scraping-oefa §Row with missing file link`). El retry
      // automaticamente la filtra porque `paramUuid === ''`.
      if (!archivo) {
        log.warn('archivo_no_disponible', {
          numeroExpediente: row.numeroExpediente,
        });
        const fallo: Fallido = {
          numeroExpediente: row.numeroExpediente,
          numeroResolucionApelacion: row.numeroResolucionApelacion,
          paramUuid: '',
          sourceId: '',
          reason: 'archivo_no_disponible',
          lastError: 'la fila no expone link al PDF',
          lastAttemptAt: new Date().toISOString(),
          attempts: 0,
        };
        collectedFallidos.push(fallo);
        pdfsFallidos += 1;
        await this.deps.store.appendFallido(fallo);
        continue;
      }

      const targetPath = this.deps.paths.pdfPath(row);

      // Paso 2: skip si valido en disco.
      const alreadyExists = await this.deps.storage.exists(targetPath);
      if (alreadyExists) {
        const head = await this.deps.storage.readFirstBytes(targetPath, 4);
        if (isValidPdfHead(head)) {
          log.debug('skip (valid PDF ya en disco)', {
            numeroExpediente: row.numeroExpediente,
          });
          pdfsSaltados += 1;
          pdfsOk += 1;
          await this.deps.store.updateDocumentoStatus(
            { paramUuid: archivo.paramUuid },
            { status: 'ok', pdfPath: targetPath },
          );
          await this.deps.store.removeFallido((f) => f.paramUuid === archivo.paramUuid);
          continue;
        }
        // Paso 3: corrupto -> delete + re-descargar.
        await this.deps.storage.deleteFile(targetPath);
        log.warn('PDF corrupto en disco, re-descargando', {
          numeroExpediente: row.numeroExpediente,
        });
      }

      // Paso 4: budget agotado -> pending (no es fallo).
      const capExhausted =
        maxPdfs !== 'unlimited' && attemptsUsed >= maxPdfs;
      if (capExhausted) {
        pending += 1;
        log.debug('budget agotado, fila queda pending', {
          numeroExpediente: row.numeroExpediente,
          pending,
        });
        continue;
      }

      // Paso 5: descargar envuelto en retry.
      let viewState = this.deps.initialViewState ?? '';
      let downloadOk = false;
      let lastError: unknown = null;

      try {
        await this.deps.scheduler.schedule(() =>
          this.deps.retry.run(
            async () => {
              const res = await this.deps.http.postDescargarPdf(
                viewState,
                archivo.sourceId,
                archivo.paramUuid,
              );
              if (res.status === 429) {
                const retryAfter = parseRetryAfterFromHeaders(res.headers);
                throw new RateLimitedError(
                  retryAfter,
                  `HTTP 429 downloading ${archivo.paramUuid}`,
                );
              }
              if (res.status >= 500 && res.status < 600) {
                throw new TransientHttpError(
                  res.status,
                  `HTTP ${res.status} downloading ${archivo.paramUuid}`,
                );
              }
              if (res.status !== 200) {
                throw new Error(`HTTP ${res.status} downloading ${archivo.paramUuid}`);
              }
              // Stream-write + validar magic bytes ANTES de aceptar.
              await this.deps.storage.streamPdf(targetPath, res.bodyBytes);
              const head = await this.deps.storage.readFirstBytes(targetPath, 4);
              if (!isValidPdfHead(head)) {
                await this.deps.storage.deleteFile(targetPath);
                throw new MagicBytesError(
                  `Magic bytes invalidos para ${archivo.paramUuid}`,
                );
              }
              return res.bodyBytes;
            },
            {
              retries: retriesPerRow - 1, // spec: retries = total - 1
              backoff: this.deps.backoff,
              scheduler: this.deps.scheduler,
              isRetryable: isRetryableDownloadError,
              logger: log,
              onRetry: (i) => {
                log.warn('retry download', {
                  paramUuid: archivo.paramUuid,
                  attempt: i.attempt,
                  delayMs: i.delayMs,
                });
              },
            },
          ),
        );
        downloadOk = true;
      } catch (err) {
        lastError = err;
      }

      attemptsUsed += 1;

      if (downloadOk) {
        pdfsOk += 1;
        pdfsDescargados += 1;
        await this.deps.store.updateDocumentoStatus(
          { paramUuid: archivo.paramUuid },
          {
            documento: row,
            status: 'ok',
            pdfPath: targetPath,
            lastAttemptAt: new Date().toISOString(),
            attempts: retriesPerRow,
          },
        );
        await this.deps.store.removeFallido((f) => f.paramUuid === archivo.paramUuid);
        log.info('pdf ok', {
          numeroExpediente: row.numeroExpediente,
          pdfPath: targetPath,
        });
        continue;
      }

      // Fallo -> fallidos.json segun razon.
      const fallo = buildFallidoFromError(row, archivo, lastError, retriesPerRow);
      collectedFallidos.push(fallo);
      pdfsFallidos += 1;
      await this.deps.store.appendFallido(fallo);
      await this.deps.store.updateDocumentoStatus(
        { paramUuid: archivo.paramUuid },
        {
          status: statusForReason(fallo.reason),
          pdfPath: null,
          lastAttemptAt: fallo.lastAttemptAt,
          attempts: retriesPerRow,
        },
      );
    }

    return {
      pdfsOk,
      pdfsFallidos,
      pdfsSaltados,
      pdfsDescargados,
      pending,
      fallidos: collectedFallidos,
    };
  }
}

function isValidPdfHead(head: Uint8Array | null): boolean {
  if (!head || head.length < 4) return false;
  // Tamano: el caller ya paso el filtro de >=1000 bytes via
  // `exists` + `readFirstBytes`; aqui solo validamos los magic bytes.
  return (
    head[0] === PDF_MAGIC[0] &&
    head[1] === PDF_MAGIC[1] &&
    head[2] === PDF_MAGIC[2] &&
    head[3] === PDF_MAGIC[3]
  );
}

function isRetryableDownloadError(e: unknown): boolean {
  return e instanceof RateLimitedError || e instanceof TransientHttpError;
}

function parseRetryAfterFromHeaders(headers: Record<string, string>): number | null {
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n * 1000);
}

function buildFallidoFromError(
  row: Documento,
  archivo: { paramUuid: string; sourceId: string },
  err: unknown,
  attempts: number,
): Fallido {
  let reason: string = 'red_desconocida';
  let lastError = safeMessage(err);
  if (err instanceof RateLimitedError) {
    reason = '429_agotado';
  } else if (err instanceof TransientHttpError) {
    reason = `http_${err.httpStatus}`;
  } else if (err instanceof MagicBytesError) {
    reason = 'magic_bytes_invalidos';
  } else if (err instanceof Error && /HTTP\s+(\d{3})/.test(err.message)) {
    const m = err.message.match(/HTTP\s+(\d{3})/);
    if (m) reason = `http_${m[1]}`;
  }
  return {
    numeroExpediente: row.numeroExpediente,
    numeroResolucionApelacion: row.numeroResolucionApelacion,
    paramUuid: archivo.paramUuid,
    sourceId: archivo.sourceId,
    reason,
    lastError,
    lastAttemptAt: new Date().toISOString(),
    attempts,
  };
}

function statusForReason(reason: string): EstadoDocumento {
  if (reason === '429_agotado') return 'fallo_429';
  return 'fallo_otro';
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Helper publico para tests: construye un `Documento` con archivo.
 * El `sourceId` se deriva del parametro `nro` (1-based; `dt:0:` para nro=1).
 */
export function makeDocWithPdf(
  expediente: string,
  resolucion: string,
  paramUuid: string,
  nro: string = '1',
): Documento {
  const sourceId = `listarDetalleInfraccionRAAForm:dt:${Number(nro) - 1}:j_idt63`;
  return {
    nro,
    numeroExpediente: expediente,
    administrado: 'X',
    unidadFiscalizable: 'Y',
    sector: 'Pesquería',
    numeroResolucionApelacion: resolucion,
    archivo: { paramUuid, sourceId },
  };
}

export function makePdfBytes(): Uint8Array {
  // %PDF-1.4\n... (100+ bytes dummy)
  const head = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const filler = new Uint8Array(1200);
  const out = new Uint8Array(head.length + filler.length);
  out.set(head, 0);
  out.set(filler, head.length);
  return out;
}

export function makeCorruptPdfBytes(): Uint8Array {
  return new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]); // "<html"
}

/** Re-export para tests. */
export type { DocumentoPersistido };