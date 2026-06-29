import { SECTOR_MAP } from '../../domain/sector-map';
import type { Sector } from '../../domain/entities';
import type {
  FormFields,
  HttpResult,
  IDataStore,
  IGridParser,
  IHttpClient,
  ILogger,
  IPaginatorParser,
} from '../../domain/ports';
import { MalformedHtmlError, ViewStateExpiredError } from '../../domain/errors';

/**
 * Opciones del caso de uso `ScrapeTablaUseCase`.
 * Ver `design.md §3.1`.
 */
export interface ScrapeTablaOpts {
  readonly sector: Sector;
  readonly maxPaginas?: number;
  readonly log: ILogger;
}

/**
 * Resultado de un scrape completo de la grilla (sin descargar PDFs).
 */
export interface ScrapeTablaResult {
  readonly paginasProcesadas: number;
  readonly totalPaginas: number | null;
  readonly documentos: import('../../domain/entities').Documento[];
}

/**
 * Tamaño minimo del body POST-buscar. Por debajo de este tamano el
 * servidor respondio solo el splash XML de PrimeFaces (no la grilla
 * completa): indica que se colaron los headers AJAX en el request
 * (ver `specs/scraping-oefa §Sending AJAX headers is rejected`).
 */
const MIN_BODY_BYTES = 5000;

/**
 * Caso de uso: bootstrap + buscar + paginar + persistir.
 * Pipeline (ver `design.md §3.3`):
 *   1. `http.bootstrap()` -> captura ViewState.
 *   2. `http.postBuscar(state.viewState, { idsector })` via scheduler.
 *   3. Si body < 5000 bytes -> `MalformedHtmlError`.
 *   4. `grid.parseGrid(html) -> Documento[]`.
 *   5. `paginator.parsePaginator(html) -> PaginaInfo` (con viewState rotado).
 *   6. `store.appendDocumentosPage(...)`.
 *   7. Mientras `haySiguiente` y no se alcance `maxPaginas`:
 *      `http.postPagina(page.viewState, nextPage)` y repetir 3..6.
 *
 * ViewState stale (0 filas en la grilla) -> re-bootstrap + retry una
 * sola vez la misma pagina (ver `specs/scraping-oefa §Stale ViewState
 * causes rejection`).
 *
 * NOTA: este caso de uso **NO** delega al scheduler para el bootstrap
 * porque el bootstrap NO requiere mantener el orden frente a otros
 * requests (es la primera operacion de la corrida). Para `postBuscar`
 * y `postPagina` se serializa via `IScheduler` para preservar la
 * invariante de `p-limit(1)`.
 */
export class ScrapeTablaUseCase {
  constructor(
    private readonly http: IHttpClient,
    private readonly grid: IGridParser,
    private readonly paginator: IPaginatorParser,
    private readonly store: IDataStore,
    private readonly scheduler: import('../../domain/ports').IScheduler,
  ) {}

  async execute(opts: ScrapeTablaOpts): Promise<ScrapeTablaResult> {
    const idsector = SECTOR_MAP[opts.sector];

    // Paso 1: bootstrap (sin scheduler: es la unica request al inicio).
    let bootstrap = await this.http.bootstrap();

    // Recolectar todos los `Documento[]` parseados.
    const allDocumentos: import('../../domain/entities').Documento[] = [];
    let paginasProcesadas = 0;
    let totalPaginas: number | null = null;
    let viewState = bootstrap.viewState;
    let pageNumber = 1;
    let continuePagination = true;
    let viewStateRetried = false;

    while (continuePagination) {
      const isFirstRequest = pageNumber === 1;
      const fields: FormFields = { idsector };
      const res: HttpResult = isFirstRequest
        ? await this.scheduler.schedule(() => this.http.postBuscar(viewState, fields))
        : await this.scheduler.schedule(() => this.http.postPagina(viewState, pageNumber));

      // Body corto = AJAX headers leak.
      if (res.bodyBytes.length < MIN_BODY_BYTES) {
        opts.log.error('MalformedHtmlError: body demasiado corto', {
          page: pageNumber,
          bytes: res.bodyBytes.length,
        });
        throw new MalformedHtmlError(
          `POST buscar/pagina devolvio ${res.bodyBytes.length} bytes (<${MIN_BODY_BYTES})`,
        );
      }

      const html = bytesToString(res.bodyBytes);
      const docs = this.grid.parseGrid(html);

      // Detectar ViewState stale: el POST devolvio una grilla vacia
      // cuando el paginator declara que deberia haber registros.
      // Re-bootstrap + retry una sola vez. Si el retry tambien da 0
      // filas (o es un caso genuino de "no hay datos para este sector"),
      // aceptamos la respuesta sin error.
      const tentativePage = safeParsePaginator(this.paginator, html);
      // La heuristica para ViewState expired: solo se reintenta si
      // es la PRIMER request (post-buscar) y el portal declara que
      // deberia haber registros. En paginas subsiguientes, una grilla
      // vacia es legitima (la ultima pagina puede traer < 10 filas).
      const paginatorExpectsData =
        tentativePage !== null &&
        (tentativePage.totalRegistros > 0 || tentativePage.haySiguiente);
      const isInitialSearch = pageNumber === 1;

      if (docs.length === 0 && isInitialSearch && paginatorExpectsData && !viewStateRetried) {
        opts.log.warn('ViewState posiblemente expirado (0 filas); re-bootstrap', {
          page: pageNumber,
        });
        bootstrap = await this.http.bootstrap();
        viewState = bootstrap.viewState;
        viewStateRetried = true;
        // No incrementamos pageNumber: reintentamos la misma pagina.
        continue;
      }

      if (docs.length === 0 && isInitialSearch && viewStateRetried && paginatorExpectsData) {
        throw new ViewStateExpiredError(
          `Grilla vacia en pagina ${pageNumber} despues de re-bootstrap`,
        );
      }

      // Reset del flag de retry para paginas siguientes.
      viewStateRetried = false;

      // Persistir esta pagina como `DocumentoPersistido` (status
      // inicial `pendiente`, pdfPath null). La conversion a
      // persistido vive en `toPersistido`.
      const persistidos = docs.map((d) => toPersistido(d));
      await this.store.appendDocumentosPage(persistidos);
      opts.log.info('commit page', {
        page: pageNumber,
        rows: docs.length,
        viewStateLength: viewState.length,
      });

      allDocumentos.push(...docs);
      paginasProcesadas = pageNumber;

      // Parsear paginator y actualizar viewState rotado.
      const page = this.paginator.parsePaginator(html);
      totalPaginas = page.totalPaginas;
      viewState = page.viewState;

      const hitCap = opts.maxPaginas !== undefined && pageNumber >= opts.maxPaginas;
      if (!page.haySiguiente || hitCap) {
        continuePagination = false;
      } else {
        pageNumber += 1;
      }
    }

    return {
      paginasProcesadas,
      totalPaginas,
      documentos: allDocumentos,
    };
  }
}

/**
 * Convierte un `Documento` (parser) en `DocumentoPersistido` (estado
 * inicial). Si la fila no tiene `archivo` (no hay PDF que descargar),
 * marcamos el status como `pendiente` igual: el sistema no lo descarga
 * pero queda registrado.
 */
function toPersistido(d: import('../../domain/entities').Documento): import('../../domain/entities').DocumentoPersistido {
  return {
    documento: d,
    status: d.archivo ? 'pendiente' : 'pendiente',
    pdfPath: null,
  };
}

/**
 * Helper: convierte `Uint8Array` a `string` UTF-8 sin dependencias
 * externas (Buffer NO esta en el port boundary). Usado por el use
 * case para alimentar a cheerio (que espera string).
 */
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Helper: intenta parsear el paginator de forma segura. Devuelve
 * `null` si el parser lanza (HTML malformado), para que el caller
 * pueda tomar la decision de re-bootstrap sin caer en una excepcion
 * que no es la que queremos reportar.
 */
function safeParsePaginator(
  parser: IPaginatorParser,
  html: string,
): import('../../domain/entities').PaginaInfo | null {
  try {
    return parser.parsePaginator(html);
  } catch {
    return null;
  }
}