import { describe, expect, it } from 'vitest';
import type {
  ArchivoRef,
  Documento,
  DocumentoPersistido,
  EstadoDocumento,
  RazonFallo,
  Sector,
} from '../../../../src/domain/entities/documento';
import { SECTOR_MAP } from '../../../../src/domain/sector-map';

/**
 * Las entidades son inmutables por contrato: los campos `readonly`
 * son enforced en tiempo de compilacion. Este test no necesita
 * ejecutarse para probar eso, pero TypeScript con `strict: true` ya
 * falla si alguien intenta `entity.foo = 'bar'`.
 *
 * El test existe para anclar la forma esperada de cada entidad y
 * detectar cambios accidentales de campos.
 */
describe('entidades de dominio', () => {
  it('SECTOR_MAP contiene los seis sectores esperados', () => {
    const expected: Record<Sector, string> = {
      TODOS: '',
      MINERIA: '1',
      ELECTRICIDAD: '2',
      HIDROCARBUROS: '3',
      INDUSTRIA: '9',
      PESQUERIA: '8',
    };
    expect(SECTOR_MAP).toEqual(expected);
  });

  it('Sector cubre los seis valores del spec', () => {
    const values: Sector[] = [
      'TODOS',
      'MINERIA',
      'ELECTRICIDAD',
      'HIDROCARBUROS',
      'INDUSTRIA',
      'PESQUERIA',
    ];
    for (const v of values) {
      expect(typeof v).toBe('string');
    }
  });

  it('EstadoDocumento cubre los cuatro valores esperados', () => {
    const values: EstadoDocumento[] = ['ok', 'fallo_429', 'fallo_otro', 'pendiente'];
    for (const v of values) {
      expect(typeof v).toBe('string');
    }
  });

  it('RazonFallo cubre las razones catalogadas', () => {
    const values: RazonFallo[] = [
      '429_agotado',
      'magic_bytes_invalidos',
      'http_500',
      'http_404',
      'archivo_no_disponible',
      'view_state_expired',
      'red_desconocida',
    ];
    for (const v of values) {
      expect(typeof v).toBe('string');
    }
  });

  it('Documento respeta la forma de siete campos string + archivo opcional', () => {
    const archivo: ArchivoRef = {
      sourceId: 'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
      paramUuid: '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
    };
    const doc: Documento = {
      nro: '1',
      numeroExpediente: '891-08-PRODUCE/DIGSECOVI-Dsvs',
      administrado: 'Corporacion del Mar S.A.',
      unidadFiscalizable: 'Planta Playa Lado Norte Puerto Malabrigo',
      sector: 'Pesqueria',
      numeroResolucionApelacion: '264-2012-OEFA/TFA',
      archivo,
    };

    expect(doc.nro).toBe('1');
    expect(doc.archivo).not.toBeNull();
    expect(doc.archivo?.paramUuid).toBe('153a6d2a-cbed-40ef-b8ef-cd2272b19867');
  });

  it('Documento.archivo puede ser null cuando la fila no tiene link', () => {
    const doc: Documento = {
      nro: '7',
      numeroExpediente: '666-2011-PRODUCE/DIGSECOVI',
      administrado: 'Americana de Conservas S.A.C.',
      unidadFiscalizable: 'Planta de Congelado',
      sector: 'Pesqueria',
      numeroResolucionApelacion: '250-2012-OEFA/TFA',
      archivo: null,
    };
    expect(doc.archivo).toBeNull();
  });

  it('DocumentoPersistido incluye status + pdfPath', () => {
    const archivo: ArchivoRef = {
      sourceId: 'src',
      paramUuid: 'uuid',
    };
    const persistido: DocumentoPersistido = {
      documento: {
        nro: '1',
        numeroExpediente: 'x',
        administrado: 'y',
        unidadFiscalizable: 'z',
        sector: 'Pesqueria',
        numeroResolucionApelacion: 'r',
        archivo,
      },
      status: 'ok',
      pdfPath: 'data/pdfs/x/r.pdf',
      attempts: 1,
      lastAttemptAt: '2026-06-29T14:30:22.500Z',
    };
    expect(persistido.status).toBe('ok');
    expect(persistido.pdfPath).toMatch(/\.pdf$/);
  });
});