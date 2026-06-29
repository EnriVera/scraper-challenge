import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { IFileStorage } from '../../domain/ports';

/**
 * Adaptador de `IFileStorage` sobre `fs/promises`.
 *
 * - `streamPdf` usa la misma estrategia atomica que `JsonDataStore`
 *   (`<target>.tmp` + `fs.rename`) para que un corte de luz a mitad de
 *   escritura no deje un PDF truncado como "completo".
 *
 * - `readFirstBytes` devuelve `null` (no tira) si el archivo no existe,
 *   para que el caso de uso de descarga pueda distinguir "archivo
 *   ausente" de "archivo corrupto" sin try/catch.
 */
export class JsFileStorage implements IFileStorage {
  async ensureDir(p: string): Promise<void> {
    await fs.mkdir(p, { recursive: true });
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p, fs.constants.F_OK);
      return true;
    } catch (err) {
      if (isENOENT(err)) return false;
      throw err;
    }
  }

  async readFirstBytes(p: string, n: number): Promise<Uint8Array | null> {
    try {
      const fh = await fs.open(p, 'r');
      try {
        const buf = Buffer.alloc(n);
        const { bytesRead } = await fh.read(buf, 0, n, 0);
        return new Uint8Array(buf.subarray(0, bytesRead));
      } finally {
        await fh.close();
      }
    } catch (err) {
      if (isENOENT(err)) return null;
      throw err;
    }
  }

  async deleteFile(p: string): Promise<void> {
    try {
      await fs.unlink(p);
    } catch (err) {
      if (isENOENT(err)) return;
      throw err;
    }
  }

  async streamPdf(targetPath: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.tmp`;
    const fh = await fs.open(tmpPath, 'w');
    try {
      await fh.writeFile(Buffer.from(bytes));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmpPath, targetPath);
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
