import type { ArchivoRef } from '../../domain/entities';

/**
 * Regex para extraer el `sourceId` (con sufijo numerico de fila) y el
 * `param_uuid` desde el atributo `onclick` de los links "Archivo" de
 * cada fila de la grilla OEFA. Viene de `design.md §4.2`.
 *
 *   group 1 = sourceIdSuffix  (debe coincidir con el rowIndex)
 *   group 2 = sourceId completo (`listarDetalleInfraccionRAAForm:dt:<n>:j_idt63`)
 *   group 3 = param_uuid (formato UUID v4)
 */
const ONCLICK_REGEX =
  /listarDetalleInfraccionRAAForm:dt:(\d+):j_idt63['"]\s*:\s*['"]([^'"]+)['"][\s\S]*?param_uuid['"]\s*:\s*['"]([0-9a-f-]{36})['"]/i;

/**
 * Parsea el atributo `onclick` de un link "Archivo" en una fila de la
 * grilla OEFA.
 *
 * Devuelve `null` si:
 *   - el atributo no contiene un `mojarra.jsfcljs` reconocible,
 *   - el grupo numerico (`sourceIdSuffix`) no coincide con el `rowIndex`
 *     real de la fila (esto cubre `specs/scraping-oefa §Row with missing file link`),
 *   - el atributo esta vacio o es `undefined`.
 *
 * Esto mantiene el parser puro y testeable sin DOM ni cheerio.
 */
export function parseMojarraOnclick(
  onclick: string | undefined,
  rowIndex: string,
): ArchivoRef | null {
  if (!onclick) return null;
  const match = ONCLICK_REGEX.exec(onclick);
  if (!match) return null;
  const sourceSuffix = match[1];
  if (sourceSuffix !== rowIndex) return null;
  return {
    sourceId: match[2],
    paramUuid: match[3],
  };
}
