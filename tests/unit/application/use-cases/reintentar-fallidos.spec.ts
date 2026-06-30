import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReintentarFallidosUseCase,
  type ReintentarFallidosOpts,
} from '../../../../src/application/use-cases/reintentar-fallidos';
import {
  DescargarPdfsUseCase,
  makeDocWithPdf,
  makePdfBytes,
} from '../../../../src/application/use-cases/descargar-pdfs';
import type {
  Documento,
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
import { NoopLogger } from '../../support/noop-logger';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeHttpClient implements IHttpClient {
  postDescargarPdfCalls: { uuid: string }[] = [];
  scrapeCalled = false;

  async bootstrap(): Promise<{ viewState: string }> { return { viewState: 'vs' }; }
  async postBuscar(): Promise<HttpResult> {
    this.scrapeCalled = true;
    return { status: 200, headers: {}, bodyBytes: new Uint8Array(0) };
  }
  async postPagina(): Promise<HttpResult> {
    this.scrapeCalled = true;
    return { status: 200, headers: {}, bodyBytes: new Uint8Array(0) };
  }
  async postDescargarPdf(_vs: string, _sid: string, uuid: string): Promise<HttpResult> {
    this.postDescargarPdfCalls.push({ uuid });
    return { status: 200, headers: {}, bodyBytes: makePdfBytes() };
  }
}

class InMemoryFileStorage implements IFileStorage {
  files = new Map<string, Uint8Array>();
  async ensureDir(): Promise<void> {}
  async exists(p: string): Promise<boolean> { return this.files.has(p); }
  async readFirstBytes(p: string, n: number): Promise<Uint8Array | null> {
    const b = this.files.get(p);
    return b ? b.subarray(0, Math.min(n, b.length)) : null;
  }
  async deleteFile(p: string): Promise<void> { this.files.delete(p); }
  async streamPdf(t: string, b: Uint8Array): Promise<void> { this.files.set(t, b); }
}

class FakeDataStore implements IDataStore {
  documentos: import('../../../../src/domain/entities').DocumentoPersistido[] = [];
  fallidos: Fallido[] = [];

  async readDocumentos(): Promise<import('../../../../src/domain/entities').DocumentoPersistido[]> {
    return this.documentos;
  }
  async appendDocumentosPage(): Promise<void> {}
  async readFallidos(): Promise<Fallido[]> { return this.fallidos; }
  async appendFallido(f: Fallido): Promise<void> { this.fallidos.push(f); }
  async removeFallido(pred: (f: Fallido) => boolean): Promise<void> {
    this.fallidos = this.fallidos.filter((f) => !pred(f));
  }
  async updateDocumentoStatus(): Promise<void> {}
}

class IdentityScheduler implements IScheduler {
  async schedule<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
}

class FakeRetryRunner implements IRetryRunner {
  async run<T>(op: (a: number) => Promise<T>, opts: RetryOpts): Promise<{ value: T; attempts: number }> {
    const maxAttempts = opts.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const v = await op(attempt);
        return { value: v, attempts: attempt };
      } catch (err) {
        if (!opts.isRetryable(err)) throw err;
        if (attempt >= maxAttempts) throw err;
      }
    }
    throw new Error('unreachable');
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

describe('ReintentarFallidosUseCase', () => {
  let http: FakeHttpClient;
  let storage: InMemoryFileStorage;
  let store: FakeDataStore;
  let retry: FakeRetryRunner;
  let scheduler: IdentityScheduler;
  let backoff: ZeroBackoff;

  beforeEach(() => {
    http = new FakeHttpClient();
    storage = new InMemoryFileStorage();
    store = new FakeDataStore();
    retry = new FakeRetryRunner();
    scheduler = new IdentityScheduler();
    backoff = new ZeroBackoff();
  });

  function build(): ReintentarFallidosUseCase {
    return new ReintentarFallidosUseCase({
      maxPdfs: 'unlimited',
      scheduler,
      http,
      retry,
      backoff,
      storage,
      store,
      paths: pathBuilder,
      retriesPerRow: 5,
    });
  }

  it('ejecuta solo sobre readFallidos(); scrape NO se llama', async () => {
    store.fallidos.push({
      numeroExpediente: 'EXP-1',
      numeroResolucionApelacion: 'R-1',
      paramUuid: 'uuid-1',
      sourceId: 'src-1',
      reason: '429_agotado',
      lastError: 'previous',
      lastAttemptAt: '2026-01-01T00:00:00Z',
      attempts: 5,
    });
    const uc = build();
    await uc.execute({ log: new NoopLogger() });

    expect(http.postDescargarPdfCalls.map((c) => c.uuid)).toEqual(['uuid-1']);
    expect(http.scrapeCalled).toBe(false);
  });

  it('reintento exitoso remueve la entrada de fallidos (spec §Successful retry removes entry)', async () => {
    store.fallidos.push({
      numeroExpediente: 'EXP-1',
      numeroResolucionApelacion: 'R-1',
      paramUuid: 'uuid-1',
      sourceId: 'src-1',
      reason: '429_agotado',
      lastError: 'previous',
      lastAttemptAt: '2026-01-01T00:00:00Z',
      attempts: 5,
    });
    const uc = build();
    const result = await uc.execute({ log: new NoopLogger() });

    expect(result.pdfsOk).toBe(1);
    expect(store.fallidos).toHaveLength(0);
  });

  it('fallidos sin paramUuid se ignoran (no se pueden descargar)', async () => {
    store.fallidos.push({
      numeroExpediente: 'EXP-no-pdf',
      numeroResolucionApelacion: 'R-X',
      paramUuid: '', // archivo_no_disponible
      sourceId: '',
      reason: 'archivo_no_disponible',
      lastError: 'no link',
      lastAttemptAt: '2026-01-01T00:00:00Z',
      attempts: 0,
    });
    const uc = build();
    const result = await uc.execute({ log: new NoopLogger() });

    expect(http.postDescargarPdfCalls).toHaveLength(0);
    expect(result.pdfsOk).toBe(0);
    expect(store.fallidos).toHaveLength(1); // sigue en fallidos
  });

  it('lista vacia -> resultado vacio sin HTTP', async () => {
    const uc = build();
    const result = await uc.execute({ log: new NoopLogger() });

    expect(result.pdfsOk).toBe(0);
    expect(result.pdfsFallidos).toBe(0);
    expect(http.postDescargarPdfCalls).toHaveLength(0);
  });

  it('respeta --max-pdfs al iterar fallidos', async () => {
    store.fallidos.push(
      {
        numeroExpediente: 'EXP-A', numeroResolucionApelacion: 'R-A',
        paramUuid: 'uuid-A', sourceId: 'src-A', reason: '429_agotado',
        lastError: 'x', lastAttemptAt: '2026-01-01T00:00:00Z', attempts: 5,
      },
      {
        numeroExpediente: 'EXP-B', numeroResolucionApelacion: 'R-B',
        paramUuid: 'uuid-B', sourceId: 'src-B', reason: '429_agotado',
        lastError: 'x', lastAttemptAt: '2026-01-01T00:00:00Z', attempts: 5,
      },
      {
        numeroExpediente: 'EXP-C', numeroResolucionApelacion: 'R-C',
        paramUuid: 'uuid-C', sourceId: 'src-C', reason: '429_agotado',
        lastError: 'x', lastAttemptAt: '2026-01-01T00:00:00Z', attempts: 5,
      },
    );
    const uc = build();
    const result = await uc.execute({ maxPdfs: 2, log: new NoopLogger() });

    // Solo se intentan 2 de los 3.
    expect(http.postDescargarPdfCalls).toHaveLength(2);
    expect(result.pdfsOk).toBe(2);
    expect(result.pending).toBe(1);
  });
});