/**
 * Operaciones de archivos para PDFs y directorios. La implementacion
 * por defecto usa `fs` (ver `infrastructure/storage/js-file-storage.ts`).
 *
 * Mantener esto como port permite escribir fakes en memoria para los
 * tests de casos de uso (PR 4).
 */
export interface IFileStorage {
  /** Crea el directorio (y sus padres) si no existe. */
  ensureDir(p: string): Promise<void>;

  /** `true` si el archivo existe y es accesible. */
  exists(p: string): Promise<boolean>;

  /**
   * Lee los primeros `n` bytes del archivo. Devuelve `null` si no
   * existe o si la lectura falla; nunca lanza.
   */
  readFirstBytes(p: string, n: number): Promise<Uint8Array | null>;

  /** Borra el archivo si existe; no-op si no esta. */
  deleteFile(p: string): Promise<void>;

  /**
   * Escribe el PDF a `targetPath` de forma atomica: escribe primero
   * `<target>.tmp` + fsync, luego `fs.rename` sobre el target.
   */
  streamPdf(targetPath: string, bytes: Uint8Array): Promise<void>;
}