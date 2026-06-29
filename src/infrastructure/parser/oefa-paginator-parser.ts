import * as cheerio from 'cheerio';
import type { PaginaInfo } from '../../domain/entities';
import type { IPaginatorParser } from '../../domain/ports';

/**
 * Regex para `<span class="ui-paginator-current">Pagina X de Y (Z registros)</span>`.
 * El texto usa "Pagina" con acento y `registro(s)` posiblemente singular;
 * la regex es laxa para tolerarlo.
 */
const PAGINATOR_TEXT_REGEX =
  /^P[aá]gina\s+(\d+)\s+de\s+(\d+)\s+\((\d+)\s+registros?\)/i;

/**
 * Implementacion de `IPaginatorParser` con cheerio.
 *
 *   - `paginaActual / totalPaginas / totalRegistros` se extraen del
 *     texto de `<span class="ui-paginator-current">`.
 *   - `viewState` se reextrae del input hidden `javax.faces.ViewState`
 *     porque rota con cada POST (per `scraping-oefa §ViewState Rotation Per Response`).
 *   - `haySiguiente` es `true` salvo que `<a class="ui-paginator-next">`
 *     tenga la clase `ui-state-disabled` (per `§Last page disables next link`).
 *
 * Si el cuerpo no tiene paginator (p.ej. busqueda sin resultados),
 * devuelve `viewState=''`, totals=0 y `haySiguiente=false`.
 */
export class OefaPaginatorParser implements IPaginatorParser {
  parsePaginator(html: string): PaginaInfo {
    const $ = cheerio.load(html);

    const viewState =
      $('input[name="javax.faces.ViewState"]').attr('value') ?? '';

    const currentText = $('span.ui-paginator-current').text().trim();
    const match = PAGINATOR_TEXT_REGEX.exec(currentText);

    let paginaActual = 0;
    let totalPaginas = 0;
    let totalRegistros = 0;
    if (match) {
      paginaActual = Number.parseInt(match[1], 10);
      totalPaginas = Number.parseInt(match[2], 10);
      totalRegistros = Number.parseInt(match[3], 10);
    }

    const nextLink = $('a.ui-paginator-next');
    const haySiguiente = nextLink.length > 0 && !nextLink.hasClass('ui-state-disabled');

    return {
      paginaActual,
      totalPaginas,
      totalRegistros,
      viewState,
      haySiguiente,
    };
  }
}
