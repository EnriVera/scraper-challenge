/**
 * Parsea el header HTTP `Retry-After` y devuelve el delay en milisegundos.
 *
 * El spec (`specs/manejo-rate-limit §Honor Retry-After Header`) dice:
 *   - "either seconds or HTTP date".
 *   - Si viene en segundos, devolver `segundos * 1000`.
 *   - Si viene como HTTP-date, devolver `(target - now)` en ms.
 *   - Si el valor > 120s, clampear a 120000 ms para no bloquear el run.
 *   - Si falla el parseo, devolver `null` y dejar que el backoff jitter
 *     siga su curso (ver `FullJitterBackoff`).
 *
 * Para que los tests sean deterministicos, se inyecta `now` (default:
 * `Date.now()`). El `now` inyectable es la unica diferencia funcional
 * con la version previa (ver `tasks.md §7.2`).
 */
export function parseRetryAfter(
  headerValue: string | undefined,
  now: number = Date.now(),
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === '') return null;

  // Variante 1: segundos enteros (o decimales). ej "30", "120", "1.5".
  // Solo aceptamos si el string luce numerico PURO (no fecha).
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (!Number.isFinite(asNumber) || asNumber < 0) return null;
    const ms = Math.floor(asNumber * 1000);
    // Clamp 120s (spec §Retry-After exceeds cap is clamped).
    return Math.min(ms, 120_000);
  }

  // Variante 2: HTTP-date (RFC 7231). ej "Wed, 21 Oct 2026 07:28:00 GMT".
  const target = Date.parse(trimmed);
  if (Number.isFinite(target)) {
    const delta = target - now;
    // Past dates: 0 ms (no espera).
    if (delta <= 0) return 0;
    // Clamp 120s (spec §Retry-After exceeds cap is clamped).
    return Math.min(delta, 120_000);
  }

  // Malformed: caemos al jitter del backoff.
  return null;
}