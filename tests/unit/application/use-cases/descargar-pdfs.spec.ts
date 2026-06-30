import { describe, it, expect, beforeEach } from 'vitest';
import {
  DescargarPdfsUseCase,
  PDF_MAGIC,
  makeDocWithPdf,
  makePdfBytes,
  makeCorruptPdfBytes,
} from '../../../../src/application/use-cases/descargar-pdfs';
import type {
  Documento,
  DocumentoPersistido,
  Fallido,
} from '../../../../src/domain/entities';
import type {
  HttpResult,
  IBackoff,
  IDataStore,
  IFileStorage,
  IHttpClient,
  IPathBuilder,
  IRetryRunner,
  IScheduler,
  RetryOpts,
} from '../../../../src/domain/ports';
import {
  MagicBytesError,
  RateLimitedError,
  TransientHttpError,
} from '../../../../src/domain/errors';
import { NoopLogger, SpyLogger } from '../../support/noop-logger';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeHttpClient implements IHttpClient {
  postDescargarPdfCalls: { vs: string; sourceId: string; uuid: string }[] = [];
  resultFn: (sourceId: string, uuid: string) => HttpResult = () => ({
    status: 200,
    headers: {},
    bodyBytes: makePdfBytes(),
  });

  async bootstrap(): Promise<{ viewState: string }> {
    return { viewState: 'vs-bootstrap' };
  }
  async postBuscar(): Promise<HttpResult> {
    throw new Error('not used in descargar-pdfs tests');
  }
  async postPagina(): Promise<HttpResult> {
    throw new Error('not used in descargar-pdfs tests');
  }
  async postDescargarPdf(viewState: string, sourceId: string, paramUuid: string): Promise<HttpResult> {
    this.postDescargarPdfCalls.push({ vs: viewState, sourceId, uuid: paramUuid });
    return this.resultFn(sourceId, paramUuid);
  }
}

class InMemoryFileStorage implements IFileStorage {
  files = new Map<string, Uint8Array>();

  async ensureDir(): Promise<void> {}
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async readFirstBytes(p: string, n: number): Promise<Uint8Array | null> {
    const bytes = this.files.get(p);
    if (!bytes) return null;
    return bytes.subarray(0, Math.min(n, bytes.length));
  }
  async deleteFile(p: string): Promise<void> {
    this.files.delete(p);
  }
  async streamPdf(targetPath: string, bytes: Uint8Array): Promise<void> {
    this.files.set(targetPath, bytes);
  }
}

class FakeDataStore implements IDataStore {
  documentos: DocumentoPersistido[] = [];
  fallidos: Fallido[] = [];
  updateCalls: { uuid: string; patch: Partial<DocumentoPersistido> }[] = [];

  async readDocumentos(): Promise<DocumentoPersistido[]> {
    return this.documentos;
  }
  async appendDocumentosPage(rows: DocumentoPersistido[]): Promise<void> {
    this.documentos.push(...rows);
  }
  async readFallidos(): Promise<Fallido[]> {
    return this.fallidos;
  }
  async appendFallido(f: Fallido): Promise<void> {
    this.fallidos.push(f);
  }
  async removeFallido(pred: (f: Fallido) => boolean): Promise<void> {
    this.fallidos = this.fallidos.filter((f) => !pred(f));
  }
  async updateDocumentoStatus(
    matchBy: { paramUuid: string },
    patch: Partial<DocumentoPersistido>,
  ): Promise<void> {
    this.updateCalls.push({ uuid: matchBy.paramUuid, patch });
  }
}

class IdentityScheduler implements IScheduler {
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/** Runner que respeta `retries` (semantica N reintentos -> N+1 attempts) sin esperar tiempos reales. */
class FakeRetryRunner implements IRetryRunner {
  sleeper: (ms: number) => Promise<void> = async () => {};

  async run<T>(op: (attempt: number) => Promise<T>, opts: RetryOpts): Promise<T> {
    let lastError: unknown;
    const maxAttempts = opts.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await op(attempt);
      } catch (err) {
        lastError = err;
        if (!opts.isRetryable(err)) throw err;
        if (attempt >= maxAttempts) throw err;
        const delay = opts.backoff.nextDelayMs(attempt);
        if (opts.onRetry) {
          try { opts.onRetry({ attempt, delayMs: delay, error: err }); } catch { /* noop */ }
        }
        await this.sleeper(delay);
      }
    }
    throw lastError;
  }
}

class ZeroBackoff implements IBackoff {
  nextDelayMs(): number { return 0; }
}

const pathBuilder: IPathBuilder = {
  pdfPath: (d: Documento) => {
    const safe = (s: string) => s.replace(/[\s/]+/g, '-');
    const dir = safe(d.numeroExpediente);
    const stem = d.numeroResolucionApelacion.trim() === ''
      ? d.archivo?.paramUuid ?? dir
      : `RTFA-N-${safe(d.numeroResolucionApelacion)}`;
    return `/tmp/test-data/pdfs/${dir}/${stem}.pdf`;
  },
};

function expectedPath(d: Documento): string {
  return pathBuilder.pdfPath(d);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DescargarPdfsUseCase', () => {
  let http: FakeHttpClient;
  let storage: InMemoryFileStorage;
  let store: FakeDataStore;
  let retry: FakeRetryRunner;
  let backoff: ZeroBackoff;
  let scheduler: IdentityScheduler;
  let log: SpyLogger;

  beforeEach(() => {
    http = new FakeHttpClient();
    storage = new InMemoryFileStorage();
    store = new FakeDataStore();
    retry = new FakeRetryRunner();
    backoff = new ZeroBackoff();
    scheduler = new IdentityScheduler();
    log = new SpyLogger();
  });

  function buildUC(retriesPerRow = 5) {
    return new DescargarPdfsUseCase({
      documentos: [],
      maxPdfs: 'unlimited',
      scheduler,
      http,
      retry,
      backoff,
      storage,
      store,
      log,
      paths: pathBuilder,
      retriesPerRow,
    });
  }

  it('skip si el PDF ya esta en disco con magic bytes validos (spec §Valid existing PDF is skipped)', async () => {
    const doc = makeDocWithPdf('891-08-PRODUCE/DIGSECOVI-Dsvs', '264-2012-OEFA/TFA', 'uuid-1');
    const path = expectedPath(doc);
    await storage.streamPdf(path, makePdfBytes());
    expect(await storage.exists(path)).toBe(true);

    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(http.postDescargarPdfCalls).toHaveLength(0); // no HTTP
    expect(result.pdfsSaltados).toBe(1);
    expect(result.pdfsDescargados).toBe(0);
    expect(result.pdfsOk).toBe(1);
  });

  it('archivo corrupto en disco se borra y se re-descarga (spec §Existing file is corrupt and is re-downloaded)', async () => {
    const doc = makeDocWithPdf('EXP-1', 'R-1', 'uuid-1');
    const path = expectedPath(doc);
    await storage.streamPdf(path, makeCorruptPdfBytes());

    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(http.postDescargarPdfCalls).toHaveLength(1); // re-descarga
    expect(result.pdfsDescargados).toBe(1);
    expect(result.pdfsSaltados).toBe(0);
  });

  it('archivo faltante en disco -> descarga inicial (spec §File missing on first run is downloaded)', async () => {
    const doc = makeDocWithPdf('EXP-2', 'R-2', 'uuid-2');
    const path = expectedPath(doc);

    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(http.postDescargarPdfCalls).toHaveLength(1);
    expect(await storage.exists(path)).toBe(true);
    expect(result.pdfsDescargados).toBe(1);
    expect(result.pdfsOk).toBe(1);
  });

  it('body sin magic bytes validos -> MagicBytesError + fallido (spec §Magic bytes missing and file rejected)', async () => {
    http.resultFn = () => ({
      status: 200,
      headers: {},
      bodyBytes: makeCorruptPdfBytes(),
    });
    const doc = makeDocWithPdf('EXP-3', 'R-3', 'uuid-3');
    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(result.pdfsFallidos).toBe(1);
    expect(store.fallidos).toHaveLength(1);
    expect(store.fallidos[0].reason).toBe('magic_bytes_invalidos');
    // El archivo parcial debe haberse borrado.
    expect(await storage.exists(expectedPath(doc))).toBe(false);
  });

  it('429 agotado -> fallidos.json reason=429_agotado attempts=5 (spec §Default budget of 5)', async () => {
    http.resultFn = () => ({
      status: 429,
      headers: { 'retry-after': '1' },
      bodyBytes: new Uint8Array(0),
    });
    const doc = makeDocWithPdf('EXP-4', 'R-4', 'uuid-4');
    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    // 5 intentos (1 inicial + 4 retries) porque maxAttempts=5
    expect(http.postDescargarPdfCalls).toHaveLength(5);
    expect(result.pdfsFallidos).toBe(1);
    expect(store.fallidos[0].reason).toBe('429_agotado');
    expect(store.fallidos[0].attempts).toBe(5);
  });

  it('--retries 2 -> 3 intentos maximos (spec §Custom budget)', async () => {
    http.resultFn = () => ({
      status: 429,
      headers: {},
      bodyBytes: new Uint8Array(0),
    });
    const doc = makeDocWithPdf('EXP-5', 'R-5', 'uuid-5');
    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 2,
    });
    const result = await uc.execute();

    expect(http.postDescargarPdfCalls).toHaveLength(2);
    expect(result.pdfsFallidos).toBe(1);
  });

  it('200 en intento 3 -> row ok + remueve de fallidos (spec §Success within budget clears the failure)', async () => {
    // Primeras 2 llamadas devuelven 429, la tercera OK.
    let callCount = 0;
    http.resultFn = () => {
      callCount += 1;
      if (callCount <= 2) {
        return { status: 429, headers: {}, bodyBytes: new Uint8Array(0) };
      }
      return { status: 200, headers: {}, bodyBytes: makePdfBytes() };
    };
    // Pre-poblar fallidos.json con la misma uuid.
    store.fallidos.push({
      numeroExpediente: 'EXP-6',
      numeroResolucionApelacion: 'R-6',
      paramUuid: 'uuid-6',
      sourceId: 'src',
      reason: '429_agotado',
      lastError: 'previous',
      lastAttemptAt: '2026-01-01T00:00:00Z',
      attempts: 5,
    });

    const doc = makeDocWithPdf('EXP-6', 'R-6', 'uuid-6');
    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(callCount).toBe(3);
    expect(result.pdfsOk).toBe(1);
    expect(store.fallidos).toHaveLength(0); // removido
    expect(store.updateCalls[0].uuid).toBe('uuid-6');
    expect(store.updateCalls[0].patch.status).toBe('ok');
  });

  it('retry de fila A bloquea fila B (sequential, spec §Sequential Retry Across Rows)', async () => {
    // El spec exige: la fila B NO arranca hasta que A haya terminado
    // todos sus retries (exito o budget agotado). Es decir, los
    // requests de A aparecen ANTES que los de B en el log de HTTP.
    const docs = [
      makeDocWithPdf('EXP-A', 'R-A', 'uuid-A', '1'),  // nro=1 -> dt:0
      makeDocWithPdf('EXP-B', 'R-B', 'uuid-B', '2'),  // nro=2 -> dt:1
    ];

    let aCalls = 0;
    let bStarted = false;
    http.resultFn = (sourceId) => {
      if (sourceId.includes(':dt:0:')) {
        aCalls += 1;
        if (aCalls <= 2) {
          return { status: 429, headers: {}, bodyBytes: new Uint8Array(0) };
        }
        return { status: 200, headers: {}, bodyBytes: makePdfBytes() };
      }
      bStarted = true;
      return { status: 200, headers: {}, bodyBytes: makePdfBytes() };
    };

    const uc = new DescargarPdfsUseCase({
      documentos: docs,
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    await uc.execute();

    expect(aCalls).toBeGreaterThanOrEqual(3);
    expect(bStarted).toBe(true);
    // El orden de los calls: primero los 3 de A, despues el de B.
    const calls = http.postDescargarPdfCalls.map((c) => c.sourceId);
    const aIndices = calls
      .map((c, i) => (c.includes(':dt:0:') ? i : -1))
      .filter((i) => i >= 0);
    const bIndices = calls
      .map((c, i) => (c.includes(':dt:1:') ? i : -1))
      .filter((i) => i >= 0);
    expect(Math.max(...aIndices)).toBeLessThan(Math.min(...bIndices));
  });

  it('--max-pdfs cuenta solo download attempts (spec §Cap counts only download attempts)', async () => {
    // 3 docs:
    //   doc1: skip (ya en disco valido)
    //   doc2: descarga OK (cuenta)
    //   doc3: queda pending (no entra)
    const doc1 = makeDocWithPdf('EXP-1', 'R-1', 'uuid-1');
    const doc2 = makeDocWithPdf('EXP-2', 'R-2', 'uuid-2');
    const doc3 = makeDocWithPdf('EXP-3', 'R-3', 'uuid-3');

    // Pre-poner doc1 como valido en disco.
    await storage.streamPdf(expectedPath(doc1), makePdfBytes());

    const uc = new DescargarPdfsUseCase({
      documentos: [doc1, doc2, doc3],
      maxPdfs: 1, // solo 1 download attempt
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(result.pdfsSaltados).toBe(1); // doc1
    expect(result.pdfsDescargados).toBe(1); // doc2
    expect(result.pending).toBe(1); // doc3
    expect(http.postDescargarPdfCalls).toHaveLength(1);
  });

  it('--max-pdfs unlimited procesa todas las filas', async () => {
    const docs = [
      makeDocWithPdf('EXP-1', 'R-1', 'uuid-1'),
      makeDocWithPdf('EXP-2', 'R-2', 'uuid-2'),
      makeDocWithPdf('EXP-3', 'R-3', 'uuid-3'),
    ];
    const uc = new DescargarPdfsUseCase({
      documentos: docs,
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(result.pdfsDescargados).toBe(3);
    expect(result.pending).toBe(0);
  });

  it('fila sin archivo (archivo=null) -> fallido archivo_no_disponible', async () => {
    const doc: Documento = {
      nro: '1',
      numeroExpediente: 'EXP-7',
      administrado: '',
      unidadFiscalizable: '',
      sector: '',
      numeroResolucionApelacion: 'R-7',
      archivo: null,
    };
    const uc = new DescargarPdfsUseCase({
      documentos: [doc],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
    const result = await uc.execute();

    expect(result.pdfsFallidos).toBe(1);
    expect(store.fallidos[0].reason).toBe('archivo_no_disponible');
    expect(store.fallidos[0].paramUuid).toBe(''); // no hay uuid
    expect(http.postDescargarPdfCalls).toHaveLength(0);
  });

  it('PDF bytes empiezan con %PDF (constante)', () => {
    expect(Array.from(PDF_MAGIC)).toEqual([0x25, 0x50, 0x44, 0x46]);
    const head = makePdfBytes().subarray(0, 4);
    expect(Array.from(head)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});