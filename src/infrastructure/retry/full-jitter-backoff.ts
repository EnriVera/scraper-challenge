import type { IBackoff } from '../../domain/ports';

/**
 * Politica de espera "AWS full jitter".
 *
 * Formula (ver `specs/manejo-rate-limit §Exponential Backoff With Full Jitter`):
 *
 *   delay = max(jittered, min(retryAfterMs ?? 0, 120000))
 *   jittered = random(0, min(cap, base * 2^attempt))
 *
 * Con defaults `base = 1000` y `cap = 60000`:
 *   - attempt=1  -> upper = min(60000, 1000*2)    = 2000   -> delay in [0, 2000)
 *   - attempt=10 -> upper = min(60000, 1000*1024) = 60000  -> delay in [0, 60000)
 *
 * El `Retry-After` del server se respeta: si dice "30s", el delay final
 * es `>= 30000`. Si dice "600" (>120s), el delay final queda
 * `clamped a 120000 ms` (spec §Retry-After exceeds cap is clamped).
 *
 * `Math.random` se inyecta via `rng` para que los tests sean
 * deterministas sin perder la firma production-grade.
 */
export class FullJitterBackoff implements IBackoff {
  private readonly baseMs: number;
  private readonly capMs: number;
  private readonly rng: () => number;

  constructor(opts: { baseMs?: number; capMs?: number; rng?: () => number } = {}) {
    this.baseMs = opts.baseMs ?? 1_000;
    this.capMs = opts.capMs ?? 60_000;
    // Math.random por default; tests inyectan uno determinista.
    this.rng = opts.rng ?? Math.random;
  }

  nextDelayMs(attempt: number, opts?: { retryAfterMs?: number | null }): number {
    if (!Number.isFinite(attempt) || attempt < 0) {
      throw new Error(`attempt must be a non-negative finite number, got ${attempt}`);
    }

    // 1. Jitter: random(0, upper) donde upper = min(cap, base * 2^attempt).
    //    Para attempt=0 -> upper = base (no pow aplicado); en la practica
    //    los callers usan attempt 1-based, pero aceptamos 0 por defensa.
    const exponential = this.baseMs * 2 ** Math.floor(attempt);
    const upper = Math.min(this.capMs, exponential);
    const jittered = Math.floor(this.rng() * upper);

    // 2. Retry-After: si viene, clampear a 120s y tomar el max.
    const retryAfterRaw = opts?.retryAfterMs ?? 0;
    const clampedRetryAfter = Math.min(Math.max(retryAfterRaw, 0), 120_000);

    return Math.max(jittered, clampedRetryAfter);
  }
}