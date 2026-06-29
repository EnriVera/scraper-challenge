import { describe, expect, it } from 'vitest';
import {
  SECTOR_MAP,
  SECTORS_VALIDOS,
} from '../../../src/domain/sector-map';

/**
 * SECTOR_MAP es la unica fuente de verdad para mapear sectores
 * logicos a codigos del formulario OEFA. Los valores exactos
 * vienen de `specs/scraping-oefa §Sector Filter Value Map`.
 *
 * Si este test falla, es muy probable que el spec haya cambiado
 * (o que alguien haya editado el mapa sin querer).
 */
describe('SECTOR_MAP', () => {
  it('TODOS -> string vacia (sin filtro)', () => {
    expect(SECTOR_MAP.TODOS).toBe('');
  });

  it('MINERIA -> "1"', () => {
    expect(SECTOR_MAP.MINERIA).toBe('1');
  });

  it('ELECTRICIDAD -> "2"', () => {
    expect(SECTOR_MAP.ELECTRICIDAD).toBe('2');
  });

  it('HIDROCARBUROS -> "3"', () => {
    expect(SECTOR_MAP.HIDROCARBUROS).toBe('3');
  });

  it('PESQUERIA -> "8"', () => {
    expect(SECTOR_MAP.PESQUERIA).toBe('8');
  });

  it('INDUSTRIA -> "9"', () => {
    expect(SECTOR_MAP.INDUSTRIA).toBe('9');
  });

  it('SECTORS_VALIDOS lista los seis sectores sin duplicados', () => {
    expect(SECTORS_VALIDOS).toHaveLength(6);
    expect(new Set(SECTORS_VALIDOS).size).toBe(6);
    expect(SECTORS_VALIDOS).toEqual([
      'TODOS',
      'MINERIA',
      'ELECTRICIDAD',
      'HIDROCARBUROS',
      'INDUSTRIA',
      'PESQUERIA',
    ]);
  });

  it('SECTOR_MAP y SECTORS_VALIDOS estan alineados', () => {
    for (const sector of SECTORS_VALIDOS) {
      expect(SECTOR_MAP[sector]).toBeDefined();
      expect(typeof SECTOR_MAP[sector]).toBe('string');
    }
  });
});