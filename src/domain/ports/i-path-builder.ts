import type { Documento } from '../entities';

/**
 * Puerto tiny para derivar la ruta del PDF en disco a partir de
 * un `Documento`. Lo extraemos del caso de uso para que la regla
 * de sanitizacion se pueda testear de forma aislada.
 *
 * Reglas (ver `specs/descarga-pdfs §PDF Filename Derived From Row Metadata`):
 *   - `dir = sanitize(numeroExpediente)` donde
 *     `sanitize(s) = s.replace(/[\s\/]+/g, '-')`
 *   - `stem = numeroResolucionApelacion.trim() === ''`
 *     ? `paramUuid`
 *     : `'RTFA-N-' + sanitize(numeroResolucionApelacion)`
 *   - ruta completa = `<dataDir>/pdfs/<dir>/<stem>.pdf`
 */
export interface IPathBuilder {
  pdfPath(d: Documento): string;
}