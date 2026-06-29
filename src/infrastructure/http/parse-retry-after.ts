/**
 * Parsea el header HTTP `Retry-After` y devuelve el delay en milisegundos.
 *
 * El spec (`specs/manejo-rate-limit §Honor Retry-After Header`) dice:
 *   - "either seconds or HTTP date".
 *   - Si viene en segundos, devolver `segundos * 1000`.
 *   - Si el valor > 120s, clampear a 120000 ms para no bloquear el run.
 *   - Si falla el parseo, devolver `null` y dejar que el backoff jitter
 *     siga su curso (ver `FullJitterBackoff`).
 *
 * Decision (design §10 issue 3): el portal OEFA solo emite segundos,
 * asi que la variante HTTP-date queda deferida. Si en el futuro el server
 * devuelve un `Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`, esta funcion
 * devolvera `null` y el backoff caera al jitter normal. Para aceptar
 * HTTP-date, agregar el parser aca (~10 lineas con `new Date(...)`).
 */
export function parseRetryAfter(headerValue: string | undefined): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === '') return null;

  // Variante 1: segundos enteros (o decimales). ej "30", "120", "1.5".
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    const ms = Math.floor(asNumber * 1000);
    // Clamp 120s (spec §Retry-After exceeds cap is clamped).
    return Math.min(ms, 120_000);
  }

  // Variante 2: HTTP-date. No implementado por ahora; devolvemos null
  // para que el caller caiga al jitter normal.
  // Ver design §10 issue 3.
  return null;
}