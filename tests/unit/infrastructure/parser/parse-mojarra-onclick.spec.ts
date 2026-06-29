import { describe, expect, it } from 'vitest';
import { parseMojarraOnclick } from '../../../../src/infrastructure/parser/parse-mojarra-onclick';

/**
 * Cubre `parseMojarraOnclick` puro (sin DOM):
 *   - happy path con sourceIdSuffix == rowIndex
 *   - regex miss (atributo vacio o malformado)
 *   - rowIndex mismatch (cubierto por `specs/scraping-oefa §Row with missing file link`)
 */
describe('parseMojarraOnclick', () => {
  it('extrae sourceId y paramUuid cuando coinciden con el rowIndex', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm')," +
      "{'listarDetalleInfraccionRAAForm:dt:0:j_idt63':'listarDetalleInfraccionRAAForm:dt:0:j_idt63'," +
      "'param_uuid':'153a6d2a-cbed-40ef-b8ef-cd2272b19867'},'');return false";
    const result = parseMojarraOnclick(onclick, '0');
    expect(result).toEqual({
      sourceId: 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
      paramUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
    });
  });

  it('devuelve null cuando el atributo es undefined', () => {
    expect(parseMojarraOnclick(undefined, '0')).toBeNull();
  });

  it('devuelve null cuando el atributo es vacio', () => {
    expect(parseMojarraOnclick('', '0')).toBeNull();
  });

  it('devuelve null cuando no hay un mojarra.jsfcljs reconocible', () => {
    expect(parseMojarraOnclick('alert("hola")', '0')).toBeNull();
  });

  it('devuelve null cuando sourceSuffix no coincide con el rowIndex', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm')," +
      "{'listarDetalleInfraccionRAAForm:dt:5:j_idt63':'listarDetalleInfraccionRAAForm:dt:5:j_idt63'," +
      "'param_uuid':'153a6d2a-cbed-40ef-b8ef-cd2272b19867'},'');return false";
    expect(parseMojarraOnclick(onclick, '0')).toBeNull();
  });

  it('acepta el patron real del portal (keys en orden sourceId, param_uuid)', () => {
    const onclick =
      "mojarra.jsfcljs(document.getElementById('listarDetalleInfraccionRAAForm')," +
      "{'listarDetalleInfraccionRAAForm:dt:7:j_idt63':'listarDetalleInfraccionRAAForm:dt:7:j_idt63'," +
      "'param_uuid':'84a8f8fb-6c37-4f9e-bb09-b075f59544c4'},'');return false";
    expect(parseMojarraOnclick(onclick, '7')?.paramUuid).toBe(
      '84a8f8fb-6c37-4f9e-bb09-b075f59544c4',
    );
  });
});
