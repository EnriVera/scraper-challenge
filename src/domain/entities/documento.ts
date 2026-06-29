/**
 * Entidades del dominio para el scraper OEFA.
 *
 * Todas las entidades son `readonly` por contrato del diseno: una vez
 * producidas por un parser o un caso de uso, no se mutan. Las mutaciones
 * (status, pdfPath, etc.) producen una nueva instancia.
 */

/** Sector del expediente. Mapeado a un codigo del formulario OEFA via `SECTOR_MAP`. */
export type Sector =
  | 'TODOS'
  | 'MINERIA'
  | 'ELECTRICIDAD'
  | 'HIDROCARBUROS'
  | 'INDUSTRIA'
  | 'PESQUERIA';

/** Estado de descarga / persistencia de un `Documento`. */
export type EstadoDocumento = 'ok' | 'fallo_429' | 'fallo_otro' | 'pendiente';

/** Razon por la que un documento paso a `fallidos.json`. */
export type RazonFallo =
  | '429_agotado'
  | 'magic_bytes_invalidos'
  | 'http_500'
  | 'http_404'
  | 'archivo_no_disponible'
  | 'view_state_expired'
  | 'red_desconocida';

/**
 * Referencia al archivo PDF asociado a un documento, extraida del
 * `onclick` del link "Archivo" en la fila de la grilla.
 */
export interface ArchivoRef {
  readonly sourceId: string;
  readonly paramUuid: string;
}

/**
 * Fila parseada de la grilla OEFA. Siete campos string en el orden
 * de las columnas de la tabla:
 *   nro | numeroExpediente | administrado | unidadFiscalizable
 *   | sector | numeroResolucionApelacion | archivo
 */
export interface Documento {
  readonly nro: string;
  readonly numeroExpediente: string;
  readonly administrado: string;
  readonly unidadFiscalizable: string;
  readonly sector: string;
  readonly numeroResolucionApelacion: string;
  readonly archivo: ArchivoRef | null;
}

/**
 * `Documento` enriquecido con el estado de descarga y la ruta local
 * del PDF una vez persistido en `data/json/documentos.json`.
 */
export interface DocumentoPersistido {
  readonly documento: Documento;
  readonly status: EstadoDocumento;
  readonly pdfPath: string | null;
  readonly lastAttemptAt?: string;
  readonly attempts?: number;
}