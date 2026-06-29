import type { Documento, PaginaInfo } from '../entities';

/**
 * Parsea la grilla `<table.grillaFlat>` del body OEFA y devuelve
 * una `Documento[]` con las siete columnas mas la referencia al
 * archivo PDF cuando la fila la expone.
 */
export interface IGridParser {
  parseGrid(html: string): Documento[];
}

/**
 * Parsea la zona del paginador PrimeFaces y devuelve:
 *  - paginaActual / totalPaginas / totalRegistros
 *  - el ViewState rotado (debe reenviarse en el siguiente POST)
 *  - haySiguiente (false cuando `.ui-state-disabled` esta presente)
 */
export interface IPaginatorParser {
  parsePaginator(html: string): PaginaInfo;
}