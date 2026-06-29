/**
 * Scheduler cooperativo. Lo usamos para serializar TODAS las
 * operaciones HTTP (paginacion + descarga) bajo `p-limit(1)`,
 * porque el `ViewState` JSF muta por request y dos requests
 * concurrentes invalidarian respuestas (ver
 * `specs/scraping-oefa §Sequential Pagination Under p-limit(1)`).
 */
export interface IScheduler {
  schedule<T>(fn: () => Promise<T>): Promise<T>;
}