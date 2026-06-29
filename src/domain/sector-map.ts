import type { Sector } from './entities/documento';

/**
 * Unica fuente de verdad para mapear sectores logicos a los codigos
 * que espera el campo `listarDetalleInfraccionRAAForm:idsector`
 * del formulario OEFA.
 *
 * Segun `specs/scraping-oefa §Sector Filter Value Map`:
 *   TODOS         -> ''    (sin filtro)
 *   MINERIA       -> '1'
 *   ELECTRICIDAD  -> '2'
 *   HIDROCARBUROS -> '3'
 *   PESQUERIA     -> '8'
 *   INDUSTRIA     -> '9'
 */
export const SECTOR_MAP: Readonly<Record<Sector, string>> = {
  TODOS: '',
  MINERIA: '1',
  ELECTRICIDAD: '2',
  HIDROCARBUROS: '3',
  INDUSTRIA: '9',
  PESQUERIA: '8',
};

export const SECTORS_VALIDOS: readonly Sector[] = [
  'TODOS',
  'MINERIA',
  'ELECTRICIDAD',
  'HIDROCARBUROS',
  'INDUSTRIA',
  'PESQUERIA',
];