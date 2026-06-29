import { describe, it, expect, beforeEach } from 'vitest';
import { ScrapeTablaUseCase } from '../../../../src/application/use-cases/scrape-tabla';
import type {
  Documento,
  DocumentoPersistido,
  PaginaInfo,
  Sector,
} from '../../../../src/domain/entities';
import type {
  FormFields,
  HttpResult,
  IDataStore,
  IGridParser,
  IHttpClient,
  IPaginatorParser,
  IScheduler,
} from '../../../../src/domain/ports';
import {
  MalformedHtmlError,
  ViewStateExpiredError,
} from '../../../../src/domain/errors';
import { NoopLogger } from '../../support/noop-logger';

// ---------------------------------------------------------------------------
// Fakes (in-memory). Mantienen el port boundary limpio: nada de fs, nada de
// axios; solo `Uint8Array` y tipos del dominio.
// ---------------------------------------------------------------------------

class FakeHttpClient implements IHttpClient {
  bootstrapCalls = 0;
  postBuscarCalls: { viewState: string; fields: FormFields }[] = [];
  postPaginaCalls: { viewState: string; pageNumber: number }[] = [];

  constructor(
    private readonly bootstrapViewState: string,
    private readonly postBuscarFn: (vs: string, f: FormFields) => HttpResult,
    private readonly postPaginaFn: (vs: string, n: number) => HttpResult,
  ) {}

  async bootstrap(): Promise<{ viewState: string }> {
    this.bootstrapCalls += 1;
    return { viewState: this.bootstrapViewState };
  }

  async postBuscar(viewState: string, fields: FormFields): Promise<HttpResult> {
    this.postBuscarCalls.push({ viewState, fields });
    return this.postBuscarFn(viewState, fields);
  }

  async postPagina(viewState: string, pageNumber: number): Promise<HttpResult> {
    this.postPaginaCalls.push({ viewState, pageNumber });
    return this.postPaginaFn(viewState, pageNumber);
  }

  async postDescargarPdf(): Promise<HttpResult> {
    throw new Error('not used in scrape-tabla tests');
  }
}

class FakeGridParser implements IGridParser {
  constructor(private readonly docsByKey: Map<string, Documento[]>) {}
  parseGrid(html: string): Documento[] {
    // Match por substring (las claves del map son "marcas" embebidas en
    // el HTML por el fake de http).
    for (const [key, docs] of this.docsByKey) {
      if (html.includes(key)) return docs;
    }
    return [];
  }
}

class FakePaginatorParser implements IPaginatorParser {
  constructor(private readonly infoByKey: Map<string, PaginaInfo>) {}
  parsePaginator(html: string): PaginaInfo {
    for (const [key, info] of this.infoByKey) {
      if (html.includes(key)) return info;
    }
    throw new Error('no paginator info for html');
  }
}

class FakeDataStore implements IDataStore {
  documentos: DocumentoPersistido[] = [];
  appendCalls = 0;

  async readDocumentos(): Promise<DocumentoPersistido[]> {
    return this.documentos;
  }
  async appendDocumentosPage(rows: DocumentoPersistido[]): Promise<void> {
    this.appendCalls += 1;
    this.documentos.push(...rows);
  }
  async readFallidos(): Promise<[]> { return []; }
  async appendFallido(): Promise<void> {}
  async removeFallido(): Promise<void> {}
  async updateDocumentoStatus(): Promise<void> {}
}

/** Scheduler identity: ejecuta en orden sin concurrencia. */
class IdentityScheduler implements IScheduler {
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

function htmlOf(s: string): string {
  // Pequeno wrapper para identificar el HTML en el fake del parser.
  return `__html__:${s}`;
}

function makeDoc(nro: string, exp: string, uuid = `uuid-${nro}`): Documento {
  return {
    nro,
    numeroExpediente: exp,
    administrado: 'A',
    unidadFiscalizable: 'U',
    sector: 'Pesquería',
    numeroResolucionApelacion: `R-${nro}`,
    archivo: { paramUuid: uuid, sourceId: `listarDetalleInfraccionRAAForm:dt:${Number(nro) - 1}:j_idt63` },
  };
}

const VS = 'view-state-1452-chars-of-data';
const VS_PAG_2 = 'view-state-rotated-1664-chars-of-data';
const VS_AFTER_RETRY = 'view-state-after-retry-1452-chars';

const PAGE1_HTML = htmlOf('page1');
const PAGE2_HTML = htmlOf('page2');
const PAGE3_HTML = htmlOf('page3');

function bigHtml(content: string): Uint8Array {
  // Padding para superar el umbral de 5000 bytes (MIN_BODY_BYTES).
  const padded = content + 'x'.repeat(5500);
  return new TextEncoder().encode(padded);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScrapeTablaUseCase', () => {
  let store: FakeDataStore;
  let scheduler: IdentityScheduler;

  beforeEach(() => {
    store = new FakeDataStore();
    scheduler = new IdentityScheduler();
  });

  it('postBuscar recibe todos los form fields + viewState (spec §POST with all form fields serialised)', async () => {
    let capturedFields: FormFields | null = null;
    let capturedViewState: string | null = null;
    const http = new FakeHttpClient(
      VS,
      (vs, f) => {
        capturedViewState = vs;
        capturedFields = f;
        return { status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) };
      },
      () => { throw new Error('not called'); },
    );
    const grid = new FakeGridParser(
      new Map([[PAGE1_HTML, [makeDoc('1', 'EXP-1'), makeDoc('2', 'EXP-2')]]]),
    );
    const paginator = new FakePaginatorParser(
      new Map([
        [PAGE1_HTML, {
          paginaActual: 1, totalPaginas: 2, totalRegistros: 20,
          viewState: VS_PAG_2, haySiguiente: false,
        }],
      ]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    const result = await uc.execute({ sector: 'PESQUERIA', log: new NoopLogger() });

    expect(capturedFields).not.toBeNull();
    expect(capturedFields!.idsector).toBe('8'); // PESQUERIA -> '8'
    expect(capturedViewState).toBe(VS);
    expect(result.documentos).toHaveLength(2);
  });

  it('body < 5000 chars lanza MalformedHtmlError (spec §Sending AJAX headers is rejected)', async () => {
    const http = new FakeHttpClient(
      VS,
      () => ({
        status: 200,
        headers: {},
        bodyBytes: new TextEncoder().encode('<html><body>too small</body></html>'),
      }),
      () => { throw new Error('not called'); },
    );
    const grid = new FakeGridParser(new Map());
    const paginator = new FakePaginatorParser(new Map());

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    await expect(
      uc.execute({ sector: 'TODOS', log: new NoopLogger() }),
    ).rejects.toBeInstanceOf(MalformedHtmlError);
  });

  it('grilla vacia (ViewState stale) dispara re-bootstrap + retry una vez (spec §Stale ViewState causes rejection)', async () => {
    const http = new FakeHttpClient(
      VS,
      () => {
        // Primer postBuscar: HTML 'empty' (0 filas, paginator declara
        // 100 registros => ViewState stale). Tras re-bootstrap: PAGE1_HTML.
        if (http.bootstrapCalls === 2) {
          return { status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) };
        }
        return { status: 200, headers: {}, bodyBytes: bigHtml('empty') };
      },
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml('empty') }),
    );
    const grid = new FakeGridParser(
      new Map([
        [PAGE1_HTML, [makeDoc('1', 'EXP-1'), makeDoc('2', 'EXP-2')]],
        ['empty', []],
      ]),
    );
    const paginator = new FakePaginatorParser(
      new Map([
        [PAGE1_HTML, {
          paginaActual: 1, totalPaginas: 1, totalRegistros: 2,
          viewState: VS_PAG_2, haySiguiente: false,
        }],
        ['empty', {
          paginaActual: 1, totalPaginas: 10, totalRegistros: 100,
          viewState: VS_PAG_2, haySiguiente: true,
        }],
      ]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    const result = await uc.execute({ sector: 'TODOS', log: new NoopLogger() });

    expect(http.bootstrapCalls).toBe(2); // bootstrap inicial + re-bootstrap
    expect(result.documentos).toHaveLength(2);
  });

  it('grilla vacia + re-bootstrap tambien vacio lanza ViewStateExpiredError', async () => {
    const http = new FakeHttpClient(
      VS,
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml('empty') }),
      () => { throw new Error('not called'); },
    );
    const grid = new FakeGridParser(new Map([['empty', []]]));
    const paginator = new FakePaginatorParser(
      new Map([['empty', {
        paginaActual: 1, totalPaginas: 5, totalRegistros: 50,
        viewState: VS_PAG_2, haySiguiente: true,
      }]]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    await expect(
      uc.execute({ sector: 'TODOS', log: new NoopLogger() }),
    ).rejects.toBeInstanceOf(ViewStateExpiredError);
  });

  it('sector TODOS envia idsector vacio (spec §Default sector is TODOS)', async () => {
    let captured: FormFields | null = null;
    const http = new FakeHttpClient(
      VS,
      (_vs, f) => {
        captured = f;
        return { status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) };
      },
      () => { throw new Error('not called'); },
    );
    const grid = new FakeGridParser(new Map([[PAGE1_HTML, []]]));
    const paginator = new FakePaginatorParser(
      new Map([[PAGE1_HTML, {
        paginaActual: 1, totalPaginas: 1, totalRegistros: 0,
        viewState: VS, haySiguiente: false,
      }]]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    await uc.execute({ sector: 'TODOS', log: new NoopLogger() });

    expect(captured!.idsector).toBe('');
  });

  it('sector PESQUERIA envia idsector "8" (spec §Explicit PESQUERIA filter)', async () => {
    let captured: FormFields | null = null;
    const http = new FakeHttpClient(
      VS,
      (_vs, f) => {
        captured = f;
        return { status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) };
      },
      () => { throw new Error('not called'); },
    );
    const grid = new FakeGridParser(new Map([[PAGE1_HTML, []]]));
    const paginator = new FakePaginatorParser(
      new Map([[PAGE1_HTML, {
        paginaActual: 1, totalPaginas: 1, totalRegistros: 0,
        viewState: VS, haySiguiente: false,
      }]]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    await uc.execute({ sector: 'PESQUERIA', log: new NoopLogger() });

    expect(captured!.idsector).toBe('8');
  });

  it('postPagina envia dt_paginator = n-1 (spec §Jump to page N)', async () => {
    const pageCalls: number[] = [];
    const http = new FakeHttpClient(
      VS,
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) }),
      (vs, n) => {
        pageCalls.push(n);
        const html = n === 2 ? PAGE2_HTML : PAGE3_HTML;
        return { status: 200, headers: {}, bodyBytes: bigHtml(html) };
      },
    );
    const grid = new FakeGridParser(
      new Map([
        [PAGE1_HTML, [makeDoc('1', 'A'), makeDoc('2', 'B')]],
        [PAGE2_HTML, [makeDoc('3', 'C'), makeDoc('4', 'D')]],
        [PAGE3_HTML, []],
      ]),
    );
    const paginator = new FakePaginatorParser(
      new Map([
        [PAGE1_HTML, {
          paginaActual: 1, totalPaginas: 3, totalRegistros: 30,
          viewState: VS_PAG_2, haySiguiente: true,
        }],
        [PAGE2_HTML, {
          paginaActual: 2, totalPaginas: 3, totalRegistros: 30,
          viewState: VS_AFTER_RETRY, haySiguiente: true,
        }],
        [PAGE3_HTML, {
          paginaActual: 3, totalPaginas: 3, totalRegistros: 30,
          viewState: VS_AFTER_RETRY, haySiguiente: false,
        }],
      ]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    const result = await uc.execute({ sector: 'TODOS', log: new NoopLogger() });

    expect(pageCalls).toEqual([2, 3]); // 1-indexed
    expect(result.paginasProcesadas).toBe(3);
    expect(result.totalPaginas).toBe(3);
    expect(result.documentos).toHaveLength(4);
  });

  it('maxPaginas limita la cantidad de paginas iteradas', async () => {
    const http = new FakeHttpClient(
      VS,
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) }),
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml(PAGE2_HTML) }),
    );
    const grid = new FakeGridParser(
      new Map([
        [PAGE1_HTML, [makeDoc('1', 'A')]],
        [PAGE2_HTML, [makeDoc('2', 'B')]],
      ]),
    );
    const paginator = new FakePaginatorParser(
      new Map([
        [PAGE1_HTML, {
          paginaActual: 1, totalPaginas: 5, totalRegistros: 50,
          viewState: VS_PAG_2, haySiguiente: true,
        }],
        [PAGE2_HTML, {
          paginaActual: 2, totalPaginas: 5, totalRegistros: 50,
          viewState: VS_AFTER_RETRY, haySiguiente: true,
        }],
      ]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    const result = await uc.execute({
      sector: 'TODOS',
      maxPaginas: 2,
      log: new NoopLogger(),
    });

    expect(result.paginasProcesadas).toBe(2);
    expect(http.postPaginaCalls).toHaveLength(1); // solo la pagina 2
    expect(store.appendCalls).toBe(2);
  });

  it('commit page persiste las filas (spec §Per-page write)', async () => {
    const http = new FakeHttpClient(
      VS,
      () => ({ status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) }),
      () => { throw new Error('not called'); },
    );
    const docs = [makeDoc('1', 'A'), makeDoc('2', 'B'), makeDoc('3', 'C')];
    const grid = new FakeGridParser(new Map([[PAGE1_HTML, docs]]));
    const paginator = new FakePaginatorParser(
      new Map([[PAGE1_HTML, {
        paginaActual: 1, totalPaginas: 1, totalRegistros: 3,
        viewState: VS_PAG_2, haySiguiente: false,
      }]]),
    );

    const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
    await uc.execute({ sector: 'TODOS', log: new NoopLogger() });

    expect(store.appendCalls).toBe(1);
    expect(store.documentos).toHaveLength(3);
    expect(store.documentos[0].documento.numeroExpediente).toBe('A');
    expect(store.documentos[0].status).toBe('pendiente');
  });

  it('tipos de sector exhaustivos', async () => {
    const expected: Record<Sector, string> = {
      TODOS: '',
      MINERIA: '1',
      ELECTRICIDAD: '2',
      HIDROCARBUROS: '3',
      INDUSTRIA: '9',
      PESQUERIA: '8',
    };
    for (const [sector, expectedCode] of Object.entries(expected) as [Sector, string][]) {
      let captured: FormFields | null = null;
      const http = new FakeHttpClient(
        VS,
        (_vs, f) => {
          captured = f;
          return { status: 200, headers: {}, bodyBytes: bigHtml(PAGE1_HTML) };
        },
        () => { throw new Error('not called'); },
      );
      const grid = new FakeGridParser(new Map([[PAGE1_HTML, []]]));
      const paginator = new FakePaginatorParser(
        new Map([[PAGE1_HTML, {
          paginaActual: 1, totalPaginas: 1, totalRegistros: 0,
          viewState: VS, haySiguiente: false,
        }]]),
      );

      const uc = new ScrapeTablaUseCase(http, grid, paginator, store, scheduler);
      await uc.execute({ sector, log: new NoopLogger() });
      expect(captured!.idsector).toBe(expectedCode);
    }
  });
});