import type { DocumentoPersistido, Fallido } from '../entities';

/**
 * Almacenamiento persistente del scraper (`data/json/documentos.json`
 * y `data/json/fallidos.json`). Todas las escrituras son atomicas
 * via temp+rename (ver `infrastructure/storage/atomic-write.ts`).
 */
export interface IDataStore {
  /** Lee todos los `DocumentoPersistido`. Devuelve `[]` si el archivo no existe. */
  readDocumentos(): Promise<DocumentoPersistido[]>;

  /**
   * Agrega los `rows` al archivo `documentos.json`. Si un `paramUuid`
   * ya existe, el incoming gana solo si su `status === 'ok'`.
   */
  appendDocumentosPage(rows: DocumentoPersistido[]): Promise<void>;

  /** Lee todos los `Fallido`. Devuelve `[]` si el archivo no existe. */
  readFallidos(): Promise<Fallido[]>;

  /**
   * Agrega un `Fallido` al archivo `fallidos.json`. Si ya existe
   * una entrada con el mismo `paramUuid`, se reemplaza.
   */
  appendFallido(fallo: Fallido): Promise<void>;

  /** Borra todas las entradas que cumplan el predicado. */
  removeFallido(predicate: (f: Fallido) => boolean): Promise<void>;

  /**
   * Actualiza campos de una entrada de `documentos.json` identificada
   * por `matchBy.paramUuid`. Crea la entrada si no existe y `documento`
   * viene en el patch.
   */
  updateDocumentoStatus(
    matchBy: { paramUuid: string },
    patch: Partial<DocumentoPersistido>,
  ): Promise<void>;
}