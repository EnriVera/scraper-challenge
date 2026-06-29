import { posix } from 'node:path';
import type { Documento } from '../../domain/entities';
import type { IPathBuilder } from '../../domain/ports';

/**
 * Deriva la ruta en disco del PDF asociado a un `Documento`.
 *
 * Reglas (ver `specs/descarga-pdfs §PDF Filename Derived From Row Metadata`
 * y `§Fallback to param_uuid`):
 *   - `dir = sanitize(numeroExpediente)` donde
 *     `sanitize(s) = s.replace(/[\s\/]+/g, '-')`.
 *   - `stem = numeroResolucionApelacion.trim() === ''`
 *       ? `paramUuid`
 *       : `'RTFA-N-' + sanitize(numeroResolucionApelacion)`.
 *   - ruta completa = `<dataDir>/pdfs/<dir>/<stem>.pdf`.
 *
 * Implementacion pura sin dependencias de Node (solo `node:path` posix)
 * para poder ejecutarse tanto en el caso de uso como en tests con
 * cualquier separador.
 */
export class OefaPathBuilder implements IPathBuilder {
  constructor(private readonly dataDir: string) {}

  pdfPath(d: Documento): string {
    const dir = sanitize(d.numeroExpediente);
    const stem =
      d.numeroResolucionApelacion.trim() === ''
        ? d.archivo?.paramUuid ?? dir
        : `RTFA-N-${sanitize(d.numeroResolucionApelacion)}`;
    return posix.join(this.dataDir, 'pdfs', dir, `${stem}.pdf`);
  }
}

/**
 * Sanitiza una cadena para usarla como segmento de ruta:
 * colapsa cualquier secuencia de espacios o barras inclinadas en un
 * unico guion. Esto cubre el caso de la spec
 * (`891-08-PRODUCE/DIGSECOVI-Dsvs` → mismo directorio),
 * ademas de saltos de linea, tabuladores y dobles espacios.
 */
export function sanitize(s: string): string {
  return s.replace(/[\s/]+/g, '-');
}
