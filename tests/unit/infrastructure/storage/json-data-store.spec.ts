import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentoPersistido, Fallido } from '../../../../src/domain/entities';
import type { ILogger } from '../../../../src/domain/ports';
import { JsonDataStore } from '../../../../src/infrastructure/storage/json-data-store';

/**
 * Logger silencioso para tests — solo queremos verificar que el
 * `commit page` se emite (no el resto).
 */
function silentLogger(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const docWithUuid = (uuid: string, nro: string): DocumentoPersistido => ({
  documento: {
    nro,
    numeroExpediente: `exp-${nro}`,
    administrado: 'A',
    unidadFiscalizable: 'U',
    sector: 'Pesqueria',
    numeroResolucionApelacion: 'r',
    archivo: {
      sourceId: `listarDetalleInfraccionRAAForm:dt:${nro}:j_idt63`,
      paramUuid: uuid,
    },
  },
  status: 'pendiente',
  pdfPath: null,
});

describe('JsonDataStore', () => {
  let dir: string;
  let log: ILogger;
  let store: JsonDataStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oefa-store-'));
    log = silentLogger();
    store = new JsonDataStore(dir, log);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ensureDirs crea data/json, data/pdfs y data/logs', async () => {
    await store.ensureDirs();
    for (const sub of ['json', 'pdfs', 'logs']) {
      const stat = await (await import('node:fs/promises')).stat(join(dir, sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('readDocumentos devuelve [] cuando el archivo no existe', async () => {
    expect(await store.readDocumentos()).toEqual([]);
  });

  it('appendDocumentosPage persiste filas y emite log info', async () => {
    await store.appendDocumentosPage([docWithUuid('uuid-1', '1')]);
    const read = await store.readDocumentos();
    expect(read).toHaveLength(1);
    expect(read[0].documento.archivo?.paramUuid).toBe('uuid-1');
    expect(log.info).toHaveBeenCalledWith('commit page', expect.objectContaining({ pages: 1, rows: 1 }));
  });

  it('appendDocumentosPage de incoming con status=ok reemplaza el previo pendiente', async () => {
    await store.appendDocumentosPage([docWithUuid('uuid-1', '1')]);
    const success: DocumentoPersistido = {
      ...docWithUuid('uuid-1', '1'),
      status: 'ok',
      pdfPath: 'data/pdfs/exp-1/RTFA-N-r.pdf',
    };
    await store.appendDocumentosPage([success]);
    const read = await store.readDocumentos();
    expect(read).toHaveLength(1);
    expect(read[0].status).toBe('ok');
    expect(read[0].pdfPath).toMatch(/\.pdf$/);
  });

  it('dedupe por paramUuid: dos incoming iguales con el mismo uuid quedan como uno', async () => {
    const incoming = [docWithUuid('dup', '1'), docWithUuid('dup', '1')];
    await store.appendDocumentosPage(incoming);
    const read = await store.readDocumentos();
    expect(read).toHaveLength(1);
  });

  it('appendFallido guarda el fallo en fallidos.json', async () => {
    const f: Fallido = {
      numeroExpediente: 'exp',
      numeroResolucionApelacion: 'r',
      paramUuid: 'uuid-1',
      sourceId: 'src',
      reason: '429_agotado',
      lastError: 'HTTP 429',
      lastAttemptAt: '2026-06-29T14:30:22.000Z',
      attempts: 6,
    };
    await store.appendFallido(f);
    const all = await store.readFallidos();
    expect(all).toHaveLength(1);
    expect(all[0].paramUuid).toBe('uuid-1');
    expect(all[0].reason).toBe('429_agotado');
  });

  it('appendFallido dedupe por paramUuid: el segundo reemplaza al primero', async () => {
    const base = (reason: string): Fallido => ({
      numeroExpediente: 'exp',
      numeroResolucionApelacion: 'r',
      paramUuid: 'uuid-2',
      sourceId: 'src',
      reason,
      lastError: reason,
      lastAttemptAt: '2026-06-29T14:30:22.000Z',
      attempts: 1,
    });
    await store.appendFallido(base('http_500'));
    await store.appendFallido(base('429_agotado'));
    const all = await store.readFallidos();
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe('429_agotado');
  });

  it('removeFallido elimina entradas que cumplen el predicado', async () => {
    const f: Fallido = {
      numeroExpediente: 'exp',
      numeroResolucionApelacion: 'r',
      paramUuid: 'uuid-3',
      sourceId: 'src',
      reason: 'http_404',
      lastError: '404',
      lastAttemptAt: '2026-06-29T14:30:22.000Z',
      attempts: 1,
    };
    await store.appendFallido(f);
    await store.removeFallido((x) => x.paramUuid === 'uuid-3');
    const all = await store.readFallidos();
    expect(all).toHaveLength(0);
  });

  it('removeFallido no reescribe si no hay cambios (sin tocar disco)', async () => {
    const f: Fallido = {
      numeroExpediente: 'exp',
      numeroResolucionApelacion: 'r',
      paramUuid: 'uuid-4',
      sourceId: 'src',
      reason: 'http_500',
      lastError: '500',
      lastAttemptAt: '2026-06-29T14:30:22.000Z',
      attempts: 1,
    };
    await store.appendFallido(f);
    await store.removeFallido((x) => x.paramUuid === 'never-matches');
    const all = await store.readFallidos();
    expect(all).toHaveLength(1);
  });

  it('updateDocumentoStatus actualiza status/pdfPath de la entrada que matchea por uuid', async () => {
    await store.appendDocumentosPage([docWithUuid('uuid-5', '1')]);
    await store.updateDocumentoStatus(
      { paramUuid: 'uuid-5' },
      { status: 'ok', pdfPath: 'data/pdfs/exp-1/file.pdf' },
    );
    const rows = await store.readDocumentos();
    expect(rows[0].status).toBe('ok');
    expect(rows[0].pdfPath).toBe('data/pdfs/exp-1/file.pdf');
  });

  it('updateDocumentoStatus ignora silenciosamente patch sin documento si no existe entry', async () => {
    await store.updateDocumentoStatus(
      { paramUuid: 'ghost' },
      { status: 'ok', pdfPath: 'data/pdfs/x/y.pdf' },
    );
    const rows = await store.readDocumentos();
    expect(rows).toHaveLength(0);
  });

  it('JSON final es parseable (atomicidad: tmp+rename, no truncado)', async () => {
    await store.appendDocumentosPage([
      docWithUuid('a', '1'),
      docWithUuid('b', '2'),
    ]);
    const txt = await readFile(join(dir, 'json', 'documentos.json'), 'utf8');
    expect(() => JSON.parse(txt)).not.toThrow();
    const parsed = JSON.parse(txt);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('sobreescritura con .tmp huerfano no rompe el archivo previo', async () => {
    // Simulamos crash mid-write: dejamos un .tmp colgando y comprobamos
    // que la limpieza no toca el archivo final.
    await store.ensureDirs();
    await store.appendDocumentosPage([docWithUuid('a', '1')]);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'json', 'documentos.json.tmp'), '{ "truncado');
    // Re-construir el store deberia limpiar el tmp.
    store = new JsonDataStore(dir, log);
    await store.ensureDirs();
    const rows = await store.readDocumentos();
    expect(rows).toHaveLength(1);
  });
});
