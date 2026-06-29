import * as cheerio from 'cheerio';
import type { Documento } from '../../domain/entities';
import type { IGridParser } from '../../domain/ports';
import { parseMojarraOnclick } from './parse-mojarra-onclick';

/**
 * Implementacion de `IGridParser` con cheerio. Ver `design.md §4.2`.
 *
 * Selectores:
 *   - filas:             `tr[data-ri]`
 *   - columnas:          `td` indexadas (0..6)
 *   - link "Archivo":    ultimo `<a>` de la fila; su `onclick` se
 *                        parsea con `parseMojarraOnclick`.
 *
 * El parser es tolerante a filas sin link de archivo (`archivo: null`)
 * porque la spec asi lo exige (`scraping-oefa §Row with missing file link`).
 */
export class OefaGridParser implements IGridParser {
  parseGrid(html: string): Documento[] {
    const $ = cheerio.load(html);
    const rows: Documento[] = [];

    $('tr[data-ri]').each((_, tr) => {
      const $tr = $(tr);
      const tds = $tr.find('td');
      const lastAnchor = $tr.find('a').last();
      const onclick = lastAnchor.attr('onclick');
      const rowIndex = $tr.attr('data-ri') ?? '';
      const archivo = parseMojarraOnclick(onclick, rowIndex);

      rows.push({
        nro: $(tds[0]).text().trim(),
        numeroExpediente: $(tds[1]).text().trim(),
        administrado: collapseBreaks($(tds[2]).html() ?? $(tds[2]).text()),
        unidadFiscalizable: $(tds[3]).text().trim(),
        sector: $(tds[4]).text().trim(),
        numeroResolucionApelacion: $(tds[5]).text().trim(),
        archivo,
      });
    });

    return rows;
  }
}

/**
 * Reemplaza `<br>` por ` | ` para que `administrado` (celda que
 * puede traer multiples razones sociales separadas por `<br>`) quede
 * legible sin perder el agrupamiento. Si no hay HTML, devuelve texto
 * tal cual.
 */
function collapseBreaks(innerHtml: string): string {
  if (!innerHtml) return '';
  return innerHtml.replace(/<br\s*\/?>/gi, ' | ').replace(/\s+/g, ' ').trim();
}
