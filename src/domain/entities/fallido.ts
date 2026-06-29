/**
 * Entrada de `data/json/fallidos.json`. Una por cada fila que no se
 * pudo descargar despues de agotar el presupuesto de reintentos.
 *
 * El comando `npm run retry` consume este archivo: vuelve a
 * descargar las filas listadas y elimina las que tengan exito.
 */
export interface Fallido {
  readonly numeroExpediente: string;
  readonly numeroResolucionApelacion: string;
  readonly paramUuid: string;
  readonly sourceId: string;
  readonly reason: string;
  readonly lastError: string;
  readonly lastAttemptAt: string;
  readonly attempts: number;
}