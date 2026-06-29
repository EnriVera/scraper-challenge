/**
 * Resultado de parsear el paginador de PrimeFaces en una respuesta del OEFA.
 *
 * `viewState` es el `javax.faces.ViewState` rotado que viene en el body
 * de la respuesta y que debe reenviarse en el siguiente POST.
 */
export interface PaginaInfo {
  readonly paginaActual: number;
  readonly totalPaginas: number;
  readonly totalRegistros: number;
  readonly viewState: string;
  readonly haySiguiente: boolean;
}