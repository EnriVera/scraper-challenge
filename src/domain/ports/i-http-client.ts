/**
 * Forma del body serializado para un POST al endpoint OEFA.
 * Los campos vacios son obligatorios: el form JSF rechaza la
 * peticion si faltan.
 */
export interface FormFields {
  readonly txtNroexp?: string;
  readonly idsector: string;
  readonly scrollState?: string;
}

/**
 * Resultado crudo de una request HTTP al OEFA. Se devuelve como
 * `Uint8Array` (no `Buffer`) para mantener el port agnostic de
 * Node y permitir fakes puros en tests.
 */
export interface HttpResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bodyBytes: Uint8Array;
}

/**
 * Puerto HTTP del scraper. Lo implementa `OefaHttpClient` en la
 * capa de infraestructura; los casos de uso lo consumen a traves
 * de esta interfaz.
 */
export interface IHttpClient {
  /** GET inicial: captura JSESSIONID + ViewState. */
  bootstrap(): Promise<{ viewState: string }>;

  /** POST buscar: dispara el primer batch de resultados. */
  postBuscar(viewState: string, fields: FormFields): Promise<HttpResult>;

  /** POST pagina N (n>=2): `dt_paginator=n-1`. */
  postPagina(viewState: string, pageNumber: number): Promise<HttpResult>;

  /** POST descargar PDF replicando `mojarra.jsfcljs`. */
  postDescargarPdf(
    viewState: string,
    sourceId: string,
    paramUuid: string,
  ): Promise<HttpResult>;
}