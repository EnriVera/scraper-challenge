import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsFileStorage } from '../../../../src/infrastructure/storage/js-file-storage';

describe('JsFileStorage', () => {
  let dir: string;
  let storage: JsFileStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oefa-fs-'));
    storage = new JsFileStorage();
  });

  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(dir, { recursive: true, force: true });
  });

  it('ensureDir crea directorios recursivamente', async () => {
    const target = join(dir, 'nested', 'deep', 'dir');
    await storage.ensureDir(target);
    const { stat } = await import('node:fs/promises');
    const st = await stat(target);
    expect(st.isDirectory()).toBe(true);
  });

  it('exists devuelve true para archivo presente y false para ausente', async () => {
    const existing = join(dir, 'file.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(existing, 'x');
    expect(await storage.exists(existing)).toBe(true);
    expect(await storage.exists(join(dir, 'missing.txt'))).toBe(false);
  });

  it('readFirstBytes devuelve los magic bytes de un PDF', async () => {
    const target = join(dir, 'sample.pdf');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, Buffer.from('%PDF-1.4 rest of pdf', 'utf8'));
    const head = await storage.readFirstBytes(target, 4);
    expect(head).not.toBeNull();
    expect(Array.from(head!)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('readFirstBytes devuelve null cuando el archivo no existe', async () => {
    expect(await storage.readFirstBytes(join(dir, 'nope.pdf'), 4)).toBeNull();
  });

  it('readFirstBytes devuelve la cantidad de bytes disponibles si el archivo es menor que n', async () => {
    const target = join(dir, 'tiny.bin');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, 'ab');
    const head = await storage.readFirstBytes(target, 10);
    expect(Array.from(head!)).toEqual([0x61, 0x62]);
  });

  it('deleteFile borra el archivo si existe', async () => {
    const target = join(dir, 'doomed.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, 'bye');
    await storage.deleteFile(target);
    expect(await storage.exists(target)).toBe(false);
  });

  it('deleteFile no falla si el archivo ya no existe (idempotente)', async () => {
    await expect(storage.deleteFile(join(dir, 'ghost.txt'))).resolves.toBeUndefined();
  });

  it('streamPdf escribe PDF con magic bytes y crea directorio padre', async () => {
    const target = join(dir, 'pdfs', 'exp', 'archivo.pdf');
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    await storage.streamPdf(target, bytes);
    const disk = await readFile(target);
    expect(Array.from(disk.subarray(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('streamPdf no deja un .tmp colgando si termina OK', async () => {
    const target = join(dir, 'archivo.pdf');
    await storage.streamPdf(target, new Uint8Array([0x25, 0x50]));
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    expect(entries).toContain('archivo.pdf');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});
