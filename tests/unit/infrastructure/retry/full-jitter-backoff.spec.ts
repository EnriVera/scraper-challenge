import { describe, it, expect } from 'vitest';
import { FullJitterBackoff } from '../../../../src/infrastructure/retry/full-jitter-backoff';

describe('FullJitterBackoff', () => {
  describe('formula AWS full jitter', () => {
    it('attempt=1 -> delay < 2000ms (spec §First retry delay bound)', () => {
      const backoff = new FullJitterBackoff();
      for (let i = 0; i < 100; i++) {
        const d = backoff.nextDelayMs(1);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(2000);
      }
    });

    it('attempt=10 -> delay < 60000ms (spec §Delay is capped at 60s)', () => {
      const backoff = new FullJitterBackoff();
      for (let i = 0; i < 100; i++) {
        const d = backoff.nextDelayMs(10);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(60_000);
      }
    });

    it('jitter aplicado: stddev(delay@attempt=3, n=100) > 0', () => {
      const backoff = new FullJitterBackoff();
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(backoff.nextDelayMs(3));
      }
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const variance =
        samples.reduce((acc, x) => acc + (x - mean) ** 2, 0) / samples.length;
      const stddev = Math.sqrt(variance);
      expect(stddev).toBeGreaterThan(0);
    });

    it('jitter con rng determinista produce valores exactos', () => {
      // rng siempre devuelve 0.999... -> jittered = floor(0.999 * upper)
      const backoff = new FullJitterBackoff({ rng: () => 0.999 });
      const d = backoff.nextDelayMs(1);
      // upper = min(60000, 1000*2) = 2000; floor(0.999 * 2000) = 1998
      expect(d).toBe(1998);
    });

    it('jitter con rng=0 da exactamente 0', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0 });
      expect(backoff.nextDelayMs(5)).toBe(0);
    });
  });

  describe('retry-after header', () => {
    it('Retry-After 30s -> delay >= 30000 (spec §Retry-After seconds respected)', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0 });
      // jittered=0, retryAfter=30000 -> max(0, 30000) = 30000
      expect(backoff.nextDelayMs(1, { retryAfterMs: 30_000 })).toBe(30_000);
    });

    it('Retry-After 600 -> delay <= 120000 (spec §Retry-After exceeds cap is clamped)', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0 });
      // 600s = 600_000ms -> clamp a 120_000
      const d = backoff.nextDelayMs(1, { retryAfterMs: 600_000 });
      expect(d).toBe(120_000);
    });

    it('retry-after mayor que jitter gana el max', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0.5 });
      // attempt=1: upper=2000, jittered=1000; retryAfter=5000 -> max(1000,5000)=5000
      expect(backoff.nextDelayMs(1, { retryAfterMs: 5_000 })).toBe(5_000);
    });

    it('jitter mayor que retry-after gana el max', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0.999 });
      // attempt=3: upper = min(60000, 1000*8) = 8000; jittered=floor(0.999*8000)=7992
      // retryAfter=1000 -> max(7992, 1000)=7992
      expect(backoff.nextDelayMs(3, { retryAfterMs: 1_000 })).toBe(7_992);
    });

    it('retryAfterMs=null cae al jitter puro', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0 });
      expect(backoff.nextDelayMs(1, { retryAfterMs: null })).toBe(0);
    });

    it('retryAfterMs undefined cae al jitter puro', () => {
      const backoff = new FullJitterBackoff({ rng: () => 0 });
      expect(backoff.nextDelayMs(1)).toBe(0);
    });
  });

  describe('parametros custom', () => {
    it('acepta baseMs y capMs custom', () => {
      const backoff = new FullJitterBackoff({ baseMs: 500, capMs: 5_000, rng: () => 0.999 });
      // attempt=1: upper = min(5000, 500*2) = 1000; jittered = floor(0.999*1000) = 999
      expect(backoff.nextDelayMs(1)).toBe(999);
    });

    it('cap se aplica siempre (incluso si base*2^attempt > cap)', () => {
      const backoff = new FullJitterBackoff({ baseMs: 1_000, capMs: 5_000, rng: () => 0.999 });
      // attempt=10: exponential = 1024000; upper = min(5000, 1024000) = 5000
      // jittered = floor(0.999 * 5000) = 4995
      expect(backoff.nextDelayMs(10)).toBe(4_995);
    });
  });

  describe('input validation', () => {
    it('attempt negativo lanza error', () => {
      const backoff = new FullJitterBackoff();
      expect(() => backoff.nextDelayMs(-1)).toThrow();
    });

    it('attempt NaN lanza error', () => {
      const backoff = new FullJitterBackoff();
      expect(() => backoff.nextDelayMs(NaN)).toThrow();
    });
  });
});