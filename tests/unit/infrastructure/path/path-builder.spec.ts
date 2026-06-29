import { describe, expect, it } from 'vitest';
import type { Documento } from '../../../../src/domain/entities/documento';
import { OefaPathBuilder, sanitize } from '../../../../src/infrastructure/path/path-builder';

/**
 * Cubre `specs/descarga-pdfs §PDF Filename Derived From Row Metadata`
 * y `§Fallback to param_uuid`. La sanitizacion vive en `path-builder.ts`
 * y se exporta para poder probarla de forma aislada.
 */
describe('OefaPathBuilder', () => {
  const dataDir = 'data';

  it('caso estandar: expediente con barra + resolucion', () => {
    const d: Documento = {
      nro: '1',
      numeroExpediente: '891-08-PRODUCE/DIGSECOVI-Dsvs',
      administrado: 'x',
      unidadFiscalizable: 'y',
      sector: 'Pesqueria',
      numeroResolucionApelacion: '264-2012-OEFA/TFA',
      archivo: {
        sourceId: 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
        paramUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
      },
    };
    const path = new OefaPathBuilder(dataDir).pdfPath(d);
    expect(path).toBe('data/pdfs/891-08-PRODUCE-DIGSECOVI-Dsvs/RTFA-N-264-2012-OEFA-TFA.pdf');
  });

  it('fallback a param_uuid cuando numeroResolucionApelacion esta vacio', () => {
    const d: Documento = {
      nro: '2',
      numeroExpediente: '891-08-PRODUCE/DIGSECOVI-Dsvs',
      administrado: 'x',
      unidadFiscalizable: 'y',
      sector: 'Pesqueria',
      numeroResolucionApelacion: '',
      archivo: {
        sourceId: 'src',
        paramUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
      },
    };
    const path = new OefaPathBuilder(dataDir).pdfPath(d);
    expect(path).toBe('data/pdfs/891-08-PRODUCE-DIGSECOVI-Dsvs/153a6d2a-cbed-40ef-b8ef-cd2272b19867.pdf');
  });

  it('reemplaza saltos de linea y tabuladores por guion', () => {
    const d: Documento = {
      nro: '1',
      numeroExpediente: '891-08\nPRODUCE\tDIGSECOVI-Dsvs',
      administrado: 'x',
      unidadFiscalizable: 'y',
      sector: 'Pesqueria',
      numeroResolucionApelacion: '264-2012-OEFA/TFA',
      archivo: { sourceId: 's', paramUuid: 'u' },
    };
    const path = new OefaPathBuilder(dataDir).pdfPath(d);
    expect(path).toBe('data/pdfs/891-08-PRODUCE-DIGSECOVI-Dsvs/RTFA-N-264-2012-OEFA-TFA.pdf');
  });

  it('reemplaza secuencias de espacios multiples por un solo guion', () => {
    const d: Documento = {
      nro: '1',
      numeroExpediente: 'A   B / C',
      administrado: 'x',
      unidadFiscalizable: 'y',
      sector: 'Pesqueria',
      numeroResolucionApelacion: 'X  Y / Z',
      archivo: { sourceId: 's', paramUuid: 'u' },
    };
    const path = new OefaPathBuilder(dataDir).pdfPath(d);
    expect(path).toBe('data/pdfs/A-B-C/RTFA-N-X-Y-Z.pdf');
  });

  it('respeta el dataDir que recibe por constructor', () => {
    const d: Documento = {
      nro: '1',
      numeroExpediente: 'exp',
      administrado: 'x',
      unidadFiscalizable: 'y',
      sector: 'Pesqueria',
      numeroResolucionApelacion: 'r',
      archivo: { sourceId: 's', paramUuid: 'u' },
    };
    expect(new OefaPathBuilder('/tmp/oefa').pdfPath(d)).toBe(
      '/tmp/oefa/pdfs/exp/RTFA-N-r.pdf',
    );
  });

  it('sanitize colapsa cualquier mezcla de \\s y / en un guion', () => {
    expect(sanitize('a b\nc\td/e')).toBe('a-b-c-d-e');
    expect(sanitize('///   ///')).toBe('-');
    expect(sanitize('')).toBe('');
  });
});
