import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Escribe `data` (ya serializado a JSON) en `targetPath` de forma atomica:
 *   1. Escribe el archivo temporal `<targetPath>.tmp`.
 *   2. `fsync` para forzar a disco (durabilidad antes del rename).
 *   3. `fs.rename(targetPath.tmp, targetPath)` — atomicidad POSIX/Windows
 *      mientras origen y destino esten en el mismo filesystem.
 *
 * Cubren `specs/persistencia-datos §Atomic JSON Write` (escenarios
 * "Atomic write success" y "Crash before rename leaves prior state intact").
 */
export async function writeJsonAtomic(targetPath: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(targetPath), { recursive: true });
  const tmpPath = join(dirname(targetPath), `${basename(targetPath)}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const fh = await fs.open(tmpPath, 'w');
  try {
    await fh.writeFile(payload, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmpPath, targetPath);
}

/**
 * Borra cualquier archivo `*.tmp` colgando de `dir` para limpiar
 * un estado dejado por una escritura interrumpida (`persistencia-datos
 * §Crash before rename leaves prior state intact`).
 *
 * Idempotente: si no existe, retorna sin error.
 */
export async function cleanupStaleTmp(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries.filter((e) => e.endsWith('.tmp')).map((e) => fs.unlink(join(dir, e))),
    );
  } catch (err) {
    if (isENOENT(err)) return;
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

/** Cross-platform basename que no toca el sistema de archivos. */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? p : p.slice(idx + 1);
}
