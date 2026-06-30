import { describe, it, expect, beforeEach } from 'vitest';
import {
  EjecucionCompletaUseCase,
  JsonStatsRecorder,
  type IStatsRecorder,
} from '../../../../src/application/use-cases/ejecucion-completa';
import {
  ScrapeTablaUseCase,
  type ScrapeTablaResult,
} from '../../../../src/application/use-cases/scrape-tabla';
import { DescargarPdfsUseCase } from '../../../../src/application/use-cases/descargar-pdfs';
import type {
  Documento,
  DocumentoPersistido,
  Fallido,
  PaginaInfo,
  RunStats,
  Sector,
} from '../../../../src/domain/entities';
import type {
  FormFields,
  HttpResult,
  IBackoff,
  IDataStore,
  IGridParser,
  IHttpClient,
  ILogger,
  IPaginatorParser,
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
  constructor(
    private readonly docs: Documento[],
    private readonly pageInfo: PaginaInfo,
  ) {}
  async bootstrap(): Promise<{ viewState: string }> { return { viewState: 'vs-bootstrap' }; }
  async postBuscar(_vs: string, _f: FormFields): Promise<HttpResult> {
    const html = '<html><body>' + 'x'.repeat(5500) + '</body></html>';
    return { status: 200, headers: {}, bodyBytes: new TextEncoder().encode(html) };
  }
  async postPagina(): Promise<HttpResult> {
    return { status: 200, headers: {}, bodyBytes: new Uint8Array(0) };
  }
  async postDescargarPdf(): Promise<HttpResult> {
    // %PDF-1.4 + padding
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const padding = new Uint8Array(1200);
    const out = new Uint8Array(bytes.length + padding.length);
    out.set(bytes, 0);
    out.set(padding, bytes.length);
    return { status: 200, headers: {}, bodyBytes: out };
  }
  getDocs(): Documento[] { return this.docs; }
  getPageInfo(): PaginaInfo { return this.pageInfo; }
}

class FakeGridParser implements IGridParser {
  constructor(private readonly docs: Documento[]) {}
  parseGrid(_html: string): Documento[] { return this.docs; }
}

class FakePaginatorParser implements IPaginatorParser {
  constructor(private readonly info: PaginaInfo) {}
  parsePaginator(_html: string): PaginaInfo { return this.info; }
}

class FakeDataStore implements IDataStore {
  documentos: DocumentoPersistido[] = [];
  fallidos: Fallido[] = [];
  async readDocumentos(): Promise<DocumentoPersistido[]> { return this.documentos; }
  async appendDocumentosPage(rows: DocumentoPersistido[]): Promise<void> { this.documentos.push(...rows); }
  async readFallidos(): Promise<Fallido[]> { return this.fallidos; }
  async appendFallido(f: Fallido): Promise<void> { this.fallidos.push(f); }
  async removeFallido(pred: (f: Fallido) => boolean): Promise<void> { this.fallidos = this.fallidos.filter((f) => !pred(f)); }
  async updateDocumentoStatus(): Promise<void> {}
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

class IdentityScheduler implements IScheduler {
  async schedule<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
}

class FakeRetryRunner implements IRetryRunner {
  async run<T>(op: (a: number) => Promise<T>, opts: RetryOpts): Promise<T> {
    const maxAttempts = opts.retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try { return await op(attempt); }
      catch (err) {
        if (!opts.isRetryable(err)) throw err;
        if (attempt >= maxAttempts) throw err;
      }
    }
    throw new Error('unreachable');
  }
}

class ZeroBackoff implements IBackoff { nextDelayMs(): number { return 0; } }

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

class SpyStatsRecorder implements IStatsRecorder {
  recorded: RunStats[] = [];
  async record(stats: RunStats, _dataDir: string): Promise<void> {
    this.recorded.push(stats);
  }
}

function makeDoc(nro: string, uuid: string): Documento {
  return {
    nro,
    numeroExpediente: `EXP-${nro}`,
    administrado: 'A',
    unidadFiscalizable: 'U',
    sector: 'Pesquería',
    numeroResolucionApelacion: `R-${nro}`,
    archivo: { paramUuid: uuid, sourceId: `listarDetalleInfraccionRAAForm:dt:${Number(nro) - 1}:j_idt63` },
  };
}

describe('EjecucionCompletaUseCase', () => {
  let http: FakeHttpClient;
  let storage: InMemoryFileStorage;
  let store: FakeDataStore;
  let scheduler: IdentityScheduler;
  let retry: FakeRetryRunner;
  let backoff: ZeroBackoff;
  let log: ILogger;
  let scrapeUC: ScrapeTablaUseCase;
  let downloadUC: DescargarPdfsUseCase;
  let stats: SpyStatsRecorder;

  beforeEach(() => {
    const docs = [makeDoc('1', 'uuid-1'), makeDoc('2', 'uuid-2'), makeDoc('3', 'uuid-3')];
    const pageInfo: PaginaInfo = {
      paginaActual: 1, totalPaginas: 1, totalRegistros: 3,
      viewState: 'vs-rotated', haySiguiente: false,
    };
    http = new FakeHttpClient(docs, pageInfo);
    storage = new InMemoryFileStorage();
    store = new FakeDataStore();
    scheduler = new IdentityScheduler();
    retry = new FakeRetryRunner();
    backoff = new ZeroBackoff();
    log = new NoopLogger();
    stats = new SpyStatsRecorder();

    scrapeUC = new ScrapeTablaUseCase(
      http,
      new FakeGridParser(docs),
      new FakePaginatorParser(pageInfo),
      store,
      scheduler,
    );
    downloadUC = new DescargarPdfsUseCase({
      documentos: [],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage, store, log, paths: pathBuilder,
      retriesPerRow: 5,
    });
  });

  it('orquesta scrape -> download -> stats y retorna RunStats', async () => {
    const uc = new EjecucionCompletaUseCase(scrapeUC, downloadUC, stats, log);
    const startedAt = new Date('2026-06-29T12:00:00Z').toISOString();
    const result = await uc.run({
      runId: 'run-test-001',
      sector: 'PESQUERIA',
      dataDir: '/tmp/test-data',
      startedAt,
    });

    // stats.json escrito via spy
    expect(stats.recorded).toHaveLength(1);
    const r = stats.recorded[0];
    expect(r.runId).toBe('run-test-001');
    expect(r.startedAt).toBe(startedAt);
    expect(r.finishedAt).toBeDefined();
    expect(r.paginasProcesadas).toBe(1);
    expect(r.totalPaginas).toBe(1);
    expect(r.documentosOk).toBe(3);   // 3 PDFs descargados
    expect(r.documentosFallidos).toBe(0);
    expect(r.documentosPendientes).toBe(0);
    expect(r.pdfsDescargados).toBe(3);

    // stats coincide con result
    expect(result.runId).toBe(r.runId);
    expect(result.documentosOk).toBe(r.documentosOk);
  });

  it('orden: scrape ANTES de download', async () => {
    // El ScrapeTablaUseCase persiste sus filas en el store ANTES de
    // que el download arranque. Esto valida el orden: cuando el
    // download arranca, el store YA tiene las filas scrapeadas.
    const uc = new EjecucionCompletaUseCase(scrapeUC, downloadUC, stats, log);

    // Spy: contar cuantos docs hay en el store cuando arranca el download.
    // Para esto interceptamos appendDocumentosPage.
    const origAppend = store.appendDocumentosPage.bind(store);
    let docsEnStoreCuandoDownloadArranca = -1;
    const DocCountingStore: IDataStore = {
      ...store,
      appendFallido: store.appendFallido.bind(store),
      readDocumentos: store.readDocumentos.bind(store),
      readFallidos: store.readFallidos.bind(store),
      removeFallido: store.removeFallido.bind(store),
      updateDocumentoStatus: store.updateDocumentoStatus.bind(store),
      appendDocumentosPage: async (rows) => {
        await origAppend(rows);
        // Si el download ya empezo (lo detectamos por un side-effect),
        // capturamos. Caso contrario, dejamos seguir.
        if (docsEnStoreCuandoDownloadArranca < 0) {
          // todavia en scrape; no es el momento de capturar
          return;
        }
      },
    };

    // Re-construir las dependencias con el store spy.
    const scrape2 = new ScrapeTablaUseCase(
      http,
      new FakeGridParser([makeDoc('1', 'uuid-1'), makeDoc('2', 'uuid-2'), makeDoc('3', 'uuid-3')]),
      new FakePaginatorParser({
        paginaActual: 1, totalPaginas: 1, totalRegistros: 3,
        viewState: 'vs-rotated', haySiguiente: false,
      }),
      DocCountingStore,
      scheduler,
    );
    const download2 = new DescargarPdfsUseCase({
      documentos: [],
      maxPdfs: 'unlimited',
      scheduler, http, retry, backoff, storage,
      store: DocCountingStore,
      log, paths: pathBuilder,
      retriesPerRow: 5,
    });

    // Marcar el momento en que arranca el download: en el primer call a http.
    const origPost = http.postDescargarPdf.bind(http);
    http.postDescargarPdf = async (...args) => {
      if (docsEnStoreCuandoDownloadArranca < 0) {
        // El download arranca; capturamos cuantos docs hay en store.
        docsEnStoreCuandoDownloadArranca = (await DocCountingStore.readDocumentos()).length;
      }
      return origPost(...args);
    };

    const uc2 = new EjecucionCompletaUseCase(scrape2, download2, stats, log);
    await uc2.run({
      runId: 'r',
      sector: 'TODOS',
      dataDir: '/tmp',
      startedAt: new Date().toISOString(),
    });

    // Cuando arranca el download, el store debe tener >= 3 docs (los scrapeados).
    expect(docsEnStoreCuandoDownloadArranca).toBe(3);

    void uc; // silence unused
  });

  it('JsonStatsRecorder escribe el archivo real', async () => {
    const tmpDir = `/tmp/test-stats-${Date.now()}`;
    const fs = await import('node:fs/promises');
    const uc = new EjecucionCompletaUseCase(scrapeUC, downloadUC, new JsonStatsRecorder(), log);
    await uc.run({
      runId: 'r',
      sector: 'TODOS',
      dataDir: tmpDir,
      startedAt: new Date().toISOString(),
    });

    const raw = await fs.readFile(`${tmpDir}/json/stats.json`, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.runId).toBe('r');
    expect(parsed.pdfsDescargados).toBe(3);

    // cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});