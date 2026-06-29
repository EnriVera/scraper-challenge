import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { DocumentoPersistido, Fallido } from '../../domain/entities';
import type { IDataStore, ILogger } from '../../domain/ports';
import { cleanupStaleTmp, writeJsonAtomic } from './atomic-write';

/**
 * Implementacion de `IDataStore` que persiste sobre el filesystem:
 *   - `data/json/documentos.json`  → array de `DocumentoPersistido`
 *   - `data/json/fallidos.json`     → array de `Fallido`
 *
 * Todas las escrituras son atomicas (`writeJsonAtomic`). Cubre los
 * escenarios de `specs/persistencia-datos §Per-page Documento Persistence`,
 * `§Atomic JSON Write`, `§Fallidos Semantics And Resume`.
 *
 * Concurrencia: el scraper es secuencial (`p-limit(1)`); por eso no
 * hace falta un lock en memoria: cada llamada carga → muta → graba
 * atomicamente.
 */
export class JsonDataStore implements IDataStore {
  private readonly documentosPath: string;
  private readonly fallidosPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly log: ILogger,
  ) {
    this.documentosPath = join(dataDir, 'json', 'documentos.json');
    this.fallidosPath = join(dataDir, 'json', 'fallidos.json');
  }

  /** Crea los directorios `json/`, `pdfs/`, `logs/` y limpia `.tmp` previos. Idempotente. */
  async ensureDirs(): Promise<void> {
    const dirs = ['json', 'pdfs', 'logs'].map((d) => join(this.dataDir, d));
    for (const d of dirs) {
      await fs.mkdir(d, { recursive: true });
    }
    await cleanupStaleTmp(join(this.dataDir, 'json'));
  }

  async readDocumentos(): Promise<DocumentoPersistido[]> {
    return readJsonArray<DocumentoPersistido>(this.documentosPath);
  }

  async appendDocumentosPage(rows: DocumentoPersistido[]): Promise<void> {
    if (rows.length === 0) return;
    await this.ensureDirs();
    const existing = await this.readDocumentos();
    const merged = mergeDocumentos(existing, rows);
    await writeJsonAtomic(this.documentosPath, merged);
    this.log.info('commit page', { pages: rows.length, rows: rows.length });
  }

  async readFallidos(): Promise<Fallido[]> {
    return readJsonArray<Fallido>(this.fallidosPath);
  }

  async appendFallido(fallo: Fallido): Promise<void> {
    await this.ensureDirs();
    const existing = await this.readFallidos();
    const filtered = existing.filter((f) => f.paramUuid !== fallo.paramUuid);
    filtered.push(fallo);
    await writeJsonAtomic(this.fallidosPath, filtered);
  }

  async removeFallido(predicate: (f: Fallido) => boolean): Promise<void> {
    const existing = await this.readFallidos();
    const remaining = existing.filter((f) => !predicate(f));
    if (remaining.length === existing.length) return;
    await writeJsonAtomic(this.fallidosPath, remaining);
  }

  async updateDocumentoStatus(
    matchBy: { paramUuid: string },
    patch: Partial<DocumentoPersistido>,
  ): Promise<void> {
    await this.ensureDirs();
    const existing = await this.readDocumentos();
    const idx = existing.findIndex(
      (r) => r.documento.archivo?.paramUuid === matchBy.paramUuid,
    );
    let next: DocumentoPersistido[];
    if (idx === -1) {
      // Sin entrada previa: solo se puede crear si el patch trae el
      // `documento` completo. Si no, no hacer nada.
      if (!patch.documento) return;
      next = [
        ...existing,
        {
          documento: patch.documento,
          status: patch.status ?? 'pendiente',
          pdfPath: patch.pdfPath ?? null,
          lastAttemptAt: patch.lastAttemptAt,
          attempts: patch.attempts,
        },
      ];
    } else {
      next = existing.slice();
      next[idx] = { ...existing[idx], ...patch };
    }
    await writeJsonAtomic(this.documentosPath, next);
  }
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as T[];
  } catch (err) {
    if (isENOENT(err)) return [];
    if (err instanceof SyntaxError) return [];
    throw err;
  }
}

/**
 * Merge entre `existing` y `incoming` keyed por `paramUuid`.
 * Si el mismo `paramUuid` aparece en ambos lados, el incoming gana
 * solo cuando su `status === 'ok'`; en otro caso, conservamos el
 * registro con mas informacion (`incoming` si todavia no existia).
 */
function mergeDocumentos(
  existing: DocumentoPersistido[],
  incoming: DocumentoPersistido[],
): DocumentoPersistido[] {
  const byUuid = new Map<string, DocumentoPersistido>();
  for (const row of existing) {
    const uuid = row.documento.archivo?.paramUuid;
    if (uuid) byUuid.set(uuid, row);
  }
  for (const row of incoming) {
    const uuid = row.documento.archivo?.paramUuid;
    if (!uuid) continue;
    const prev = byUuid.get(uuid);
    if (!prev || row.status === 'ok') {
      byUuid.set(uuid, row);
    }
  }
  // Orden estable por nro para mantener la persistencia legible.
  return Array.from(byUuid.values()).sort((a, b) =>
    a.documento.nro.localeCompare(b.documento.nro, 'es', { numeric: true }),
  );
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
