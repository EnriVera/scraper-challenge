/**
 * Errores del dominio. No importan nada de Node ni de axios: son
 * tipos puros que los adapters levantan y los casos de uso
 * interpretan.
 *
 * El conjunto reintentable esta compuesto por `RateLimitedError`,
 * `TransientHttpError` (5xx) y errores de red crudos. El resto
 * (`ViewStateExpiredError`, `MagicBytesError`, `MalformedHtmlError`,
 * 4xx no-429) no se reintenta: refleja un fallo de programacion o
 * de contrato.
 */

/** HTTP 429 - "Too Many Requests". `retryAfterMs` viene del header `Retry-After`. */
export class RateLimitedError extends Error {
  constructor(
    public readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/** HTTP 5xx - "Transient". La capa de retry lo reintentara. */
export class TransientHttpError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'TransientHttpError';
  }
}

/**
 * El servidor respondio 200 pero la grilla vino vacia: senal canonica
 * de `ViewState` expirado o desincronizado (ver
 * `specs/scraping-oefa §Stale ViewState causes rejection`).
 */
export class ViewStateExpiredError extends Error {
  constructor(message?: string) {
    super(message ?? 'ViewState expired: server returned empty grilla');
    this.name = 'ViewStateExpiredError';
  }
}

/** Los primeros 4 bytes del cuerpo descargado no son `%PDF`. */
export class MagicBytesError extends Error {
  constructor(message?: string) {
    super(message ?? 'PDF magic bytes mismatch: file does not start with %PDF');
    this.name = 'MagicBytesError';
  }
}

/**
 * El POST-buscar devolvio un body < 5000 chars: indica que se nos
 * colaron los headers AJAX (`Faces-Request: partial/ajax` o
 * `X-Requested-With: XMLHttpRequest`) y el server devolvio solo el
 * splash XML en vez de la grilla completa.
 */
export class MalformedHtmlError extends Error {
  constructor(message?: string) {
    super(message ?? 'Malformed HTML response (AJAX headers leaked into POST)');
    this.name = 'MalformedHtmlError';
  }
}