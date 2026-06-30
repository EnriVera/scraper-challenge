import type { ILogger } from './i-logger';
import type { IScheduler } from './i-scheduler';

/**
 * Politica de espera entre reintentos. Implementacion canonica:
 * "AWS full jitter": `delay = random(0, min(cap, base * 2^attempt))`.
 */
export interface IBackoff {
  /**
   * Devuelve el delay en ms para el siguiente reintento.
   *
   * - `attempt` es 1-based (1 = primer reintento).
   * - `opts.retryAfterMs` (opcional) viene del header HTTP
   *   `Retry-After` parseado. Si viene, el delay final debe ser
   *   `max(jittered, min(retryAfterMs, 120000))`.
   */
  nextDelayMs(attempt: number, opts?: { retryAfterMs?: number | null }): number;
}

/**
 * Opciones para un reintento individual. Las usan los casos de
 * uso al envolver una operacion HTTP en el `IRetryRunner`.
 */
export interface RetryOpts {
  /**
   * Numero de reintentos **despues del intento inicial**.
   * Total de attempts observados = `retries + 1`.
   * Default CLI: 5 reintentos -> 6 attempts totales
   * (ver `specs/manejo-rate-limit §Retry Budget Per Request`).
   */
  readonly retries: number;
  /** Politica de espera (ver `IBackoff`). */
  readonly backoff: IBackoff;
  /** Scheduler compartido; serializa los reintentos para no fan-out. */
  readonly scheduler: IScheduler;
  /** Determina si un error amerita un reintento o es terminal. */
  readonly isRetryable: (e: unknown) => boolean;
  /** Hook para logging/observabilidad antes de cada sleep. */
  readonly onRetry?: (i: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Logger opcional para que el runner reporte reintentos automaticamente. */
  readonly logger?: ILogger;
}

/**
 * Ejecuta una operacion `op` con reintentos. Por defecto solo se
 * reintentan los errores que cumplen `isRetryable`; el resto se
 * propagan de inmediato. Al agotar `maxAttempts`, se relanza el
 * ultimo error.
 */
export interface IRetryRunner {
  run<T>(op: (attempt: number) => Promise<T>, opts: RetryOpts): Promise<T>;
}