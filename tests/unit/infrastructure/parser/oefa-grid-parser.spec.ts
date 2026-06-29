import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OefaGridParser } from '../../../../src/infrastructure/parser/oefa-grid-parser';

/**
 * Cubre `specs/scraping-oefa §Row To Documento Mapping`:
 *   - happy path: la primera fila del fixture `try-4-nonajax.html`
 *     se mapea a las 7 columnas + archivo con `paramUuid` y `sourceId`.
 *   - fila sin link `<a>`: `archivo = null`.
 */
describe('OefaGridParser', () => {
  const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/try-4-nonajax.html');
  const FIXTURE_HTML = readFileSync(FIXTURE_PATH, 'utf8');

  it('parses la primera fila del fixture try-4-nonajax.html con las 7 columnas + archivo', () => {
    const rows = new OefaGridParser().parseGrid(FIXTURE_HTML);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const first = rows[0];
    // numeroExpediente exacto del fixture (el fixture es PESQUERIA, expediente
    // del primer registro segun el spike).
    expect(first.numeroExpediente).toBe('891-08-PRODUCE/DIGSECOVI-Dsvs');
    expect(first.numeroResolucionApelacion).toBe('264-2012-OEFA/TFA');
    expect(first.sector).toBe('Pesquería');
    expect(first.archivo).toEqual({
      sourceId: 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
      paramUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
    });
  });

  it('extraelos 10 registros del fixture (data-ri 0..9)', () => {
    const rows = new OefaGridParser().parseGrid(FIXTURE_HTML);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.nro)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });

  it('cada fila tiene un paramUuid unico cuando el onclick esta presente', () => {
    const rows = new OefaGridParser().parseGrid(FIXTURE_HTML);
    const uuids = rows.map((r) => r.archivo?.paramUuid).filter(Boolean);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(uuids.length).toBe(10);
  });

  it('archivo = null en una fila HTML sin link (build on-the-fly para no mutar fixture)', () => {
    const html = `
      <html><body>
        <table>
          <tbody>
            <tr data-ri="0">
              <td>1</td>
              <td>X-2024</td>
              <td>Adm</td>
              <td>UF</td>
              <td>Pesqueria</td>
              <td>R-1</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `;
    const rows = new OefaGridParser().parseGrid(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].archivo).toBeNull();
    expect(rows[0].numeroExpediente).toBe('X-2024');
  });

  it('archivo = null cuando el link existe pero no es mojarra.jsfcljs', () => {
    const html = `
      <html><body>
        <table><tbody>
          <tr data-ri="0">
            <td>1</td><td>X</td><td>A</td><td>U</td><td>P</td><td>R</td>
            <td><a href="#" onclick="alert('nope')">x</a></td>
          </tr>
        </tbody></table>
      </body></html>
    `;
    const rows = new OefaGridParser().parseGrid(html);
    expect(rows[0].archivo).toBeNull();
  });

  it('parsea administrado colapsando <br> en " | "', () => {
    const html = `
      <html><body><table><tbody>
        <tr data-ri="0">
          <td>1</td><td>X</td><td>A<br>B<br>C</td><td>U</td><td>P</td><td>R</td>
          <td></td>
        </tr>
      </tbody></table></body></html>
    `;
    const rows = new OefaGridParser().parseGrid(html);
    expect(rows[0].administrado).toBe('A | B | C');
  });
});
