import type { Documento, Fallido } from '../../domain/entities';
import type { ILogger } from '../../domain/ports';
import { DescargarPdfsUseCase, type DescargarOpts, type DescargarResult } from './descargar-pdfs';

/**
 * Opciones del caso de uso `ReintentarFallidosUseCase`.
 */
export interface ReintentarFallidosOpts {
  readonly maxPdfs?: number | 'unlimited';
  readonly log: ILogger;
}

/**
 * Caso de uso: re-intentar SOLO las filas listadas en `fallidos.json`.
 * NO invoca el caso de uso de scrape (no re-itera la grilla).
 *
 * Pipeline (ver `design.md §3.1`):
 *   1. `store.readFallidos()` -> `Fallido[]`.
 *   2. Por cada `Fallido` con `paramUuid`, construir un `Documento`
 *      minimo (no tenemos todos los 7 campos; solo lo necesario para
 *      `IPathBuilder.pdfPath(...)`).
 *   3. Delegar a `DescargarPdfsUseCase.run(documentos, override)`
 *      donde `override` puede pisar `maxPdfs`.
 *   4. El `DescargarPdfsUseCase` ya hace `removeFallido(...)` para
 *      los que tengan exito.
 *
 * Para evitar acoplar la firma de `DescargarPdfsUseCase.execute()`,
 * este use case crea una instancia efimera con las deps heredadas +
 * los documentos del fallidos.json. Es trabajo extra en runtime pero
 * mantiene el contrato de cada use case simple.
 */
export class ReintentarFallidosUseCase {
  constructor(private readonly deps: Omit<DescargarOpts, 'documentos' | 'log'>) {}

  async execute(opts: ReintentarFallidosOpts): Promise<DescargarResult> {
    const store = this.deps.store;
    const log = opts.log;
    const fallidos = await store.readFallidos();
    log.info('retry starting', { count: fallidos.length });

    // Solo los que tengan `paramUuid` son descargables.
    const documentos: Documento[] = fallidos
      .filter((f) => f.paramUuid !== '')
      .map(fallidoToDocumento);

    if (documentos.length === 0) {
      return {
        pdfsOk: 0,
        pdfsFallidos: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 0,
        pending: 0,
        fallidos,
        reintentosTotales: 0,
      };
    }

    const subDeps: DescargarOpts = {
      ...this.deps,
      documentos,
      log,
      maxPdfs: opts.maxPdfs ?? this.deps.maxPdfs ?? 'unlimited',
    };

    const download = new DescargarPdfsUseCase(subDeps);
    return download.execute();
  }
}

/**
 * Reconstruye un `Documento` minimo a partir de un `Fallido` para que
 * `IPathBuilder.pdfPath(...)` funcione. Solo necesitamos los campos
 * que el path-builder lee: `numeroExpediente`, `numeroResolucionApelacion`,
 * y `archivo.paramUuid`.
 */
function fallidoToDocumento(f: Fallido): Documento {
  return {
    nro: '0',
    numeroExpediente: f.numeroExpediente,
    administrado: '',
    unidadFiscalizable: '',
    sector: '',
    numeroResolucionApelacion: f.numeroResolucionApelacion,
    archivo: { paramUuid: f.paramUuid, sourceId: f.sourceId },
  };
}