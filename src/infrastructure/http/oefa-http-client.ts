import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';
import { CookieJar } from 'tough-cookie';
import type { ILogger } from '../../domain/ports';
import type {
  FormFields,
  HttpResult,
  IHttpClient,
} from '../../domain/ports';
import {
  RateLimitedError,
  TransientHttpError,
} from '../../domain/errors';
import { parseRetryAfter } from './parse-retry-after';
import { extractViewState } from './view-state-extractor';

/**
 * Inyector de "sleep" para que `delayBetweenRequestsMs` no haga
 * esperar milisegundos reales en tests. Default: `setTimeout`.
 */
export type Sleeper = (ms: number) => Promise<void>;
const defaultSleeper: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cliente HTTP para el portal OEFA (`publico.oefa.gob.pe`). Implementa
 * `IHttpClient` (ver `design.md §4.1` y `specs/scraping-oefa`).
 *
 * Responsabilidades:
 *   - Mantener `JSESSIONID` (cookie HttpOnly + Secure) entre requests
 *     mediante un `tough-cookie.CookieJar` + interceptor manual.
 *   - Mantener `currentViewState` (input JSF) y reenviar el ultimo en
 *     cada POST (rotacion canonica del spec).
 *   - Traducir respuestas HTTP a errores de dominio:
 *       429 -> `RateLimitedError(retryAfterMs)`
 *       5xx -> `TransientHttpError(status)`
 *       otros 4xx -> rethrow (axios error nativo, no reintentable)
 *
 * Decisiones (ver `design.md §10 issue 1`):
 *   - Cookie management: hand-rolled interceptor sobre `tough-cookie`.
 *     NO usamos `axios-cookiejar-support` para mantener dep count bajo.
 *     El jar maneja HttpOnly + Secure correctamente via tough-cookie.
 *
 * Tests: `oefa-http-client.spec.ts` mockea el `AxiosInstance` con
 * `axios-mock-adapter`. PR 5 hace el smoke contra el portal real;
 * PR 3 NO toca la red.
 */
export class OefaHttpClient implements IHttpClient {
  private readonly axios: AxiosInstance;
  private readonly log: ILogger;
  private readonly cookieJar: CookieJar;
  private readonly baseURL: string;
  private readonly delayBetweenRequestsMs: number;
  private readonly sleeper: Sleeper;
  private currentViewState: string | null = null;

  constructor(opts: {
    axios?: AxiosInstance;
    log: ILogger;
    baseURL?: string;
    delayBetweenRequestsMs?: number;
    sleeper?: Sleeper;
  }) {
    this.log = opts.log;
    this.baseURL = opts.baseURL ?? 'https://publico.oefa.gob.pe';
    this.cookieJar = new CookieJar();
    this.delayBetweenRequestsMs = opts.delayBetweenRequestsMs ?? 0;
    this.sleeper = opts.sleeper ?? defaultSleeper;

    this.axios =
      opts.axios ??
      axios.create({
        baseURL: this.baseURL,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-PE,es;q=0.9,en;q=0.8',
        },
        // Importante: responseType 'arraybuffer' para que el body llegue
        // como Buffer; lo pasamos a Uint8Array en `toHttpResult`.
        responseType: 'arraybuffer',
        // NO seguir redirects automatico al portal de login (si el server
        // devolviera un 302 al index.xhtml queremos ver el response).
        maxRedirects: 0,
        // Timeout generoso para no colgar el scraper.
        timeout: 60_000,
        // Importante: false para que tough-cookie maneje HttpOnly + Secure.
        withCredentials: false,
      });

    this.installCookieInterceptors();
  }

  /** Ultimo ViewState conocido (o null si no se hizo bootstrap). */
  getCurrentViewState(): string | null {
    return this.currentViewState;
  }

  /** Acceso al jar (para tests/debug). No usar en produccion. */
  getCookieJar(): CookieJar {
    return this.cookieJar;
  }

  // ----- IHttpClient -----

  async bootstrap(): Promise<{ viewState: string }> {
    const url = '/repdig/consulta/consultaTfa.xhtml';
    this.log.debug('http.bootstrap.start', { url });

    let response: AxiosResponse;
    try {
      response = await this.axios.get(url, {
        // Asegurar que axios NO mande partial/ajax headers.
        headers: {
          'Faces-Request': undefined,
          'X-Requested-With': undefined,
        },
      });
    } catch (err) {
      this.log.error('http.bootstrap.network_error', { error: String(err) });
      throw err;
    }

    if (response.status < 200 || response.status >= 300) {
      this.log.error('http.bootstrap.non_2xx', { status: response.status });
      throw new Error(`bootstrap failed: HTTP ${response.status}`);
    }

    const html = bufferToString(response.data);
    const viewState = extractViewState(html);
    if (!viewState || viewState.length < 1000) {
      this.log.error('http.bootstrap.missing_viewstate', { len: viewState?.length ?? 0 });
      throw new Error(
        `bootstrap failed: no ViewState found (got ${viewState?.length ?? 0} chars)`,
      );
    }

    this.currentViewState = viewState;
    this.log.debug('http.bootstrap.ok', { viewStateLen: viewState.length });
    return { viewState };
  }

  async postBuscar(viewState: string, fields: FormFields): Promise<HttpResult> {
    const body = buildBuscarBody(viewState, fields);
    const url = '/repdig/consulta/consultaTfa.xhtml';
    this.log.debug('http.postBuscar.start', { url, sector: fields.idsector });

    const response = await this.post(url, body);
    this.updateViewStateFromResponse(response);
    return response;
  }

  async postPagina(viewState: string, pageNumber: number): Promise<HttpResult> {
    if (!Number.isInteger(pageNumber) || pageNumber < 2) {
      throw new Error(`postPagina: pageNumber must be integer >= 2, got ${pageNumber}`);
    }
    const body = buildPaginaBody(viewState, pageNumber);
    const url = '/repdig/consulta/consultaTfa.xhtml';
    this.log.debug('http.postPagina.start', { url, page: pageNumber });

    const response = await this.post(url, body);
    this.updateViewStateFromResponse(response);
    return response;
  }

  async postDescargarPdf(
    viewState: string,
    sourceId: string,
    paramUuid: string,
  ): Promise<HttpResult> {
    if (!sourceId || !paramUuid) {
      throw new Error('postDescargarPdf: sourceId and paramUuid are required');
    }
    const body = buildDescargarPdfBody(viewState, sourceId, paramUuid);
    const url = '/repdig/consulta/consultaTfa.xhtml';
    this.log.debug('http.postDescargarPdf.start', { url, sourceId, paramUuid });

    // Las descargas NO actualizan currentViewState: el PDF no contiene
    // un input ViewState (es binario) y mantener el del ultimo POST
    // de paginacion/buscar es lo correcto.
    return await this.post(url, body);
  }

  // ----- Internals -----

  /**
   * Instala los interceptors axios que sincronizan cookies con el
   * `CookieJar` de tough-cookie. Patron:
   *   - request: serializar cookies del jar y agregarlas a `Cookie: ...`.
   *   - response: si hay `Set-Cookie`, agregarlas al jar.
   *
   * tough-cookie maneja HttpOnly y Secure internamente; no es necesario
   * filtrar nada en el interceptor.
   */
  private installCookieInterceptors(): void {
    this.axios.interceptors.request.use(async (config) => {
      const url = absoluteUrl(config.baseURL, config.url ?? '');
      const cookies = await this.cookieJar.getCookies(url);
      if (cookies.length > 0) {
        const header = cookies.map((c) => `${c.key}=${c.value}`).join('; ');
        config.headers = config.headers ?? {};
        config.headers['Cookie'] = header;
      }
      // Garantizar que NO se envien headers AJAX (rompen la grilla).
      config.headers = config.headers ?? {};
      delete config.headers['Faces-Request'];
      delete config.headers['X-Requested-With'];
      return config;
    });

    this.axios.interceptors.response.use(async (response) => {
      const url = absoluteUrl(response.config.baseURL, response.config.url ?? '');
      const setCookies = readSetCookieHeaders(response.headers);
      for (const raw of setCookies) {
        await this.cookieJar.setCookie(raw, url);
      }
      return response;
    });
  }

  private async post(url: string, body: string): Promise<HttpResult> {
    let response: AxiosResponse;
    try {
      response = await this.axios.post(url, body, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: `${this.baseURL}/repdig/consulta/consultaTfa.xhtml`,
        },
      });
    } catch (err) {
      throw mapAxiosError(err, this.log);
    }
    const result = toHttpResult(response);
    // Delay entre requests (spec §CLI Surface Includes --delay-ms): solo
    // se ejecuta despues de una respuesta exitosa (no en errores de red
    // ni 4xx/5xx, donde el retry layer toma el control).
    if (this.delayBetweenRequestsMs > 0) {
      await this.sleeper(this.delayBetweenRequestsMs);
    }
    return result;
  }

  private updateViewStateFromResponse(response: HttpResult): void {
    const html = bufferToString(response.bodyBytes);
    const next = extractViewState(html);
    if (next && next.length > 0) {
      this.currentViewState = next;
    }
  }
}

// ----- Helpers (exported for tests) -----

/**
 * Construye el body del POST buscar segun `design.md §3.5`. Mantiene
 * el orden canonico que espera el server (parametros autogenerados
 * `j_idt*` se mandan vacios para que el form se serialice completo).
 */
export function buildBuscarBody(viewState: string, fields: FormFields): string {
  const params = new URLSearchParams();
  params.set('listarDetalleInfraccionRAAForm', 'listarDetalleInfraccionRAAForm');
  params.set('listarDetalleInfraccionRAAForm:txtNroexp', fields.txtNroexp ?? '');
  params.set('listarDetalleInfraccionRAAForm:j_idt21', '');
  params.set('listarDetalleInfraccionRAAForm:j_idt25', '');
  params.set('listarDetalleInfraccionRAAForm:j_idt34', '');
  params.set('listarDetalleInfraccionRAAForm:idsector', fields.idsector);
  params.set(
    'listarDetalleInfraccionRAAForm:dt_scrollState',
    fields.scrollState ?? '0,0',
  );
  params.set('listarDetalleInfraccionRAAForm:btnBuscar', 'btnBuscar');
  params.set('javax.faces.ViewState', viewState);
  return params.toString();
}

/** Body para `dt_paginator=n-1` (POST pagina N, n>=2). */
export function buildPaginaBody(viewState: string, pageNumber: number): string {
  const params = new URLSearchParams();
  params.set('listarDetalleInfraccionRAAForm', 'listarDetalleInfraccionRAAForm');
  params.set('listarDetalleInfraccionRAAForm:dt_paginator', String(pageNumber - 1));
  params.set('javax.faces.ViewState', viewState);
  return params.toString();
}

/** Body para descarga de PDF replicando `mojarra.jsfcljs`. */
export function buildDescargarPdfBody(
  viewState: string,
  sourceId: string,
  paramUuid: string,
): string {
  const params = new URLSearchParams();
  params.set('listarDetalleInfraccionRAAForm', 'listarDetalleInfraccionRAAForm');
  params.set(sourceId, sourceId);
  params.set('param_uuid', paramUuid);
  params.set('javax.faces.ViewState', viewState);
  return params.toString();
}

function toHttpResult(response: AxiosResponse): HttpResult {
  const buf = response.data;
  const bytes =
    buf instanceof Buffer
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : buf instanceof Uint8Array
        ? buf
        : new Uint8Array(Buffer.from(buf));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(response.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return {
    status: response.status,
    headers,
    bodyBytes: bytes,
  };
}

function bufferToString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf-8');
}

function absoluteUrl(
  baseURL: string | undefined,
  url: string,
): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseURL) return url;
  if (url.startsWith('/')) return `${baseURL}${url}`;
  return `${baseURL}/${url}`;
}

/**
 * `response.headers` de axios puede ser plano o un objeto AxiosHeaders.
 * AxiosHeaders expone `.get('set-cookie')` que devuelve array. Para
 * acceder a los headers raw en algunos casos hay que ir a `headers['set-cookie']`.
 * Esta funcion normaliza ambas formas.
 */
function readSetCookieHeaders(headers: unknown): string[] {
  if (!headers || typeof headers !== 'object') return [];
  const h = headers as Record<string, unknown>;
  const candidate =
    h['set-cookie'] ??
    h['Set-Cookie'] ??
    (typeof (h as { get?: (k: string) => unknown }).get === 'function'
      ? (h as { get: (k: string) => unknown }).get('set-cookie')
      : undefined);
  if (Array.isArray(candidate)) return candidate.map(String);
  if (typeof candidate === 'string') return [candidate];
  return [];
}

/**
 * Mapea un error de axios a errores de dominio. 429 -> RateLimitedError
 * con retryAfterMs del header; 5xx -> TransientHttpError; el resto
 * se re-lanza (los casos de uso lo marcan como no reintentable).
 */
function mapAxiosError(err: unknown, log: ILogger): unknown {
  if (err instanceof RateLimitedError || err instanceof TransientHttpError) {
    return err;
  }
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError;
    const status = ax.response?.status;
    if (status === 429) {
      const raw =
        (ax.response?.headers as Record<string, unknown> | undefined)?.[
          'retry-after'
        ] ?? (ax.response?.headers as Record<string, unknown> | undefined)?.['Retry-After'];
      const retryAfterMs = parseRetryAfter(asString(raw));
      log.warn('http.429', { retryAfterMs });
      return new RateLimitedError(
        retryAfterMs,
        `HTTP 429 from OEFA portal (retryAfterMs=${retryAfterMs})`,
      );
    }
    if (status !== undefined && status >= 500 && status < 600) {
      log.warn('http.5xx', { status });
      return new TransientHttpError(
        status,
        `HTTP ${status} from OEFA portal`,
      );
    }
  }
  return err;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}