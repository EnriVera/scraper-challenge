import * as cheerio from 'cheerio';

/**
 * Extrae el `javax.faces.ViewState` de un HTML de respuesta del portal OEFA.
 * El input aparece como:
 *
 *   <input type="hidden" name="javax.faces.ViewState" id="..." value="...">
 *
 * La spec (`scraping-oefa §Bootstrap Session With Initial GET`) exige
 * que el ViewState tenga al menos 1000 chars; devolvemos `null` si no
 * encontramos nada, dejando que el caller decida si falla o usa el
 * valor previo.
 *
 * Usamos cheerio (ya dependencia del proyecto para los parsers de
 * grilla/paginator) por consistencia; un regex serviria pero la
 * robustez frente a variaciones del HTML es mejor con DOM real.
 */
export function extractViewState(html: string): string | null {
  if (!html || typeof html !== 'string') return null;
  const $ = cheerio.load(html);
  const value = $('input[name="javax.faces.ViewState"]').attr('value');
  if (!value) return null;
  return value;
}