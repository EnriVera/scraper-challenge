import type {
  IBackoff,
  IRetryRunner,
  RetryOpts,
  RetryResult,
} from '../../domain/ports';

/**
 * Inyector de "sleep" para que los tests no esperen milisegundos reales.
 * Default: `setTimeout` envuelto en Promise.
 */
export type Sleeper = (ms: number) => Promise<void>;

const defaultSleeper: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecutor de reintentos con backoff. Cumple `IRetryRunner` (ver
 * `design.md §4.7` y `specs/manejo-rate-limit §Retry Budget Per Request`).
 *
 * Algoritmo:
 *   1. attempt = 1
 *   2. op(attempt)
 *   3. exito -> retorna
 *   4. fallo:
 *      a. si !isRetryable(err) -> throw err (no se reintenta)
 *      b. si attempt > retries -> throw err (presupuesto agotado)
 *      c. delay = backoff.nextDelayMs(attempt, { retryAfterMs: err.retryAfterMs })
 *      d. logger?.warn / onRetry
 *      e. sleep(delay)
 *      f. attempt++, volver a 2
 *
 * El `attempt` que recibe `op` es 1-based (1 = primer intento).
 * El campo `opts.retries` cuenta **reintentos despues del inicial**:
 * total de attempts observados = `retries + 1` (spec
 * `manejo-rate-limit §Retry Budget Per Request`).
 */
export class BackoffRetryRunner implements IRetryRunner {
  private readonly sleeper: Sleeper;

  constructor(sleeper: Sleeper = defaultSleeper) {
    this.sleeper = sleeper;
  }

  async run<T>(op: (attempt: number) => Promise<T>, opts: RetryOpts): Promise<RetryResult<T>> {
    if (opts.retries < 0) {
      throw new Error(
        `BackoffRetryRunner: retries must be >= 0, got ${opts.retries}`,
      );
    }
    const maxAttempts = opts.retries + 1; // total attempts = retries + 1 (spec)

    let lastError: unknown;
    let finalAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const value = await op(attempt);
        finalAttempts = attempt;
        return { value, attempts: finalAttempts };
      } catch (err) {
        lastError = err;
        finalAttempts = attempt;

        if (!opts.isRetryable(err)) {
          throw err;
        }
        if (attempt >= maxAttempts) {
          // Presupuesto agotado: propagar el ultimo error.
          throw err;
        }

        const retryAfterMs = extractRetryAfterMs(err);
        const delayMs = opts.backoff.nextDelayMs(attempt, { retryAfterMs });

        if (opts.onRetry) {
          try {
            opts.onRetry({ attempt, delayMs, error: err });
          } catch {
            // El hook de observabilidad no debe tumbar el retry.
          }
        }
        if (opts.logger) {
          opts.logger.warn('retry', {
            attempt,
            nextAttempt: attempt + 1,
            delayMs,
            retries: opts.retries,
            error: serializeError(err),
          });
        }

        await this.sleeper(delayMs);
      }
    }

    // Inalcanzable: el bucle siempre retorna o lanza en la ultima
    // iteracion, pero TS necesita esta linea.
    throw lastError;
  }
}

/**
 * Extrae `retryAfterMs` de un error conocido. Acepta:
 *   - `RateLimitedError` (campo directo, ver `domain/errors.ts`).
 *   - axios-like error con `response.headers['retry-after']`.
 * Devuelve `null` si no se puede extraer.
 */
function extractRetryAfterMs(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const e = err as { retryAfterMs?: unknown; response?: { headers?: unknown } };
    if (typeof e.retryAfterMs === 'number') return e.retryAfterMs;
    if (typeof e.retryAfterMs === 'string') {
      const n = Number(e.retryAfterMs);
      return Number.isFinite(n) ? n : null;
    }
    const headers = e.response?.headers;
    if (headers && typeof headers === 'object') {
      const h = headers as Record<string, unknown>;
      const raw = h['retry-after'] ?? h['Retry-After'];
      if (typeof raw === 'string' || typeof raw === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? Math.floor(n * 1000) : null;
      }
    }
  }
  return null;
}

function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { name: 'UnknownError', message: String(err) };
}

/**
 * Helper de testing: un `IBackoff` determinista que siempre devuelve
 * el delay que le pasan (o 0 si no le pasan nada).
 */
export function constantBackoff(delayMs = 0): IBackoff {
  return {
    nextDelayMs: () => delayMs,
  };
}