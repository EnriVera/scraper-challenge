import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OefaPaginatorParser } from '../../../../src/infrastructure/parser/oefa-paginator-parser';

/**
 * Cubre `specs/scraping-oefa §Paginator Parsing And Navigation`:
 *   - `§Paginator total detection`: parsea "Pagina 1 de 176 (1753 registros)".
 *   - `§Last page disables next link`: `haySiguiente=false` cuando
 *     `a.ui-paginator-next` lleva `ui-state-disabled`.
 */
describe('OefaPaginatorParser', () => {
  const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/try-4-nonajax.html');
  const FIXTURE_HTML = readFileSync(FIXTURE_PATH, 'utf8');

  it('parsea el paginador del fixture (Pagina 1 de 176, 1753 registros)', () => {
    const page = new OefaPaginatorParser().parsePaginator(FIXTURE_HTML);
    expect(page.paginaActual).toBe(1);
    expect(page.totalPaginas).toBe(176);
    expect(page.totalRegistros).toBe(1753);
    expect(page.viewState.length).toBeGreaterThan(1000);
  });

  it('haySiguiente=true en el fixture (next NO tiene ui-state-disabled)', () => {
    const page = new OefaPaginatorParser().parsePaginator(FIXTURE_HTML);
    expect(page.haySiguiente).toBe(true);
  });

  it('haySiguiente=false cuando el link next tiene ui-state-disabled (ultima pagina)', () => {
    const html = `
      <html><body>
        <input name="javax.faces.ViewState" value="abc" />
        <span class="ui-paginator-current">Página 176 de 176 (1753 registros)</span>
        <a class="ui-paginator-next ui-state-disabled ui-state-default" aria-label="Next Page" href="#">></a>
      </body></html>
    `;
    const page = new OefaPaginatorParser().parsePaginator(html);
    expect(page.haySiguiente).toBe(false);
    expect(page.totalPaginas).toBe(176);
    expect(page.viewState).toBe('abc');
  });

  it('devuelve totales=0 cuando no hay paginator en el body (busqueda sin resultados)', () => {
    const html = `
      <html><body>
        <input name="javax.faces.ViewState" value="vstate" />
        <table class="grillaFlat"><tbody class="ui-datatable-empty-message"></tbody></table>
      </body></html>
    `;
    const page = new OefaPaginatorParser().parsePaginator(html);
    expect(page.paginaActual).toBe(0);
    expect(page.totalPaginas).toBe(0);
    expect(page.totalRegistros).toBe(0);
    expect(page.viewState).toBe('vstate');
    expect(page.haySiguiente).toBe(false);
  });
});
