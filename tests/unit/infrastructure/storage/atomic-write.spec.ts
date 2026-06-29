import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupStaleTmp, writeJsonAtomic } from '../../../../src/infrastructure/storage/atomic-write';

describe('atomic-write', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oefa-atomic-'));
  });

  afterEach(async () => {
    await (await import('node:fs/promises')).rm(dir, { recursive: true, force: true });
  });

  it('escribe el archivo final sin dejar el .tmp', async () => {
    const target = join(dir, 'foo.json');
    await writeJsonAtomic(target, { a: 1 });
    const raw = await readFile(target, 'utf8');
    expect(JSON.parse(raw)).toEqual({ a: 1 });
    const entries = await (await import('node:fs/promises')).readdir(dir);
    expect(entries).toEqual(['foo.json']);
  });

  it('sobrescribe el archivo sin corromper el previo si el target existe', async () => {
    const target = join(dir, 'foo.json');
    await writeJsonAtomic(target, { version: 1 });
    await writeJsonAtomic(target, { version: 2 });
    const raw = await readFile(target, 'utf8');
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });

  it('crea directorios intermedios', async () => {
    const target = join(dir, 'nested/deep/foo.json');
    await writeJsonAtomic(target, [1, 2, 3]);
    const raw = await readFile(target, 'utf8');
    expect(JSON.parse(raw)).toEqual([1, 2, 3]);
  });

  it('cleanupStaleTmp elimina archivos *.tmp y deja los finales intactos', async () => {
    const target = join(dir, 'foo.json');
    await writeJsonAtomic(target, { ok: true });
    // Simulamos un crash: dejamos un .tmp colgando.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'foo.json.tmp'), '[1,2,3');
    await writeFile(join(dir, 'bar.json.tmp'), '[4,5');

    await cleanupStaleTmp(dir);

    const { readdir, readFile: rf, stat } = await import('node:fs/promises');
    const entries = (await readdir(dir)).sort();
    expect(entries).toContain('foo.json');
    expect(entries).not.toContain('foo.json.tmp');
    expect(entries).not.toContain('bar.json.tmp');
    // El archivo previo sigue intacto.
    const txt = await rf(target, 'utf8');
    expect(JSON.parse(txt)).toEqual({ ok: true });
    // El dir ya esta limpio.
    const st = await stat(target);
    expect(st.isFile()).toBe(true);
  });

  it('cleanupStaleTmp no falla si el directorio no existe', async () => {
    await expect(cleanupStaleTmp(join(dir, 'nope'))).resolves.toBeUndefined();
  });
});
