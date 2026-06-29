import { describe, it, expect, vi } from 'vitest';
import {
  BackoffRetryRunner,
  constantBackoff,
} from '../../../../src/infrastructure/retry/backoff-retry-runner';
import {
  RateLimitedError,
  TransientHttpError,
} from '../../../../src/domain/errors';
import type { IBackoff, IScheduler, RetryOpts } from '../../../../src/domain/ports';

const noopSleeper: (ms: number) => Promise<void> = async () => {};

function buildOpts(overrides: Partial<RetryOpts> = {}): RetryOpts {
  return {
    maxAttempts: 3,
    backoff: constantBackoff(0),
    scheduler: {
      schedule: <T>(fn: () => Promise<T>): Promise<T> => fn(),
    } as IScheduler,
    isRetryable: (e: unknown) =>
      e instanceof RateLimitedError || e instanceof TransientHttpError,
    ...overrides,
  };
}

describe('BackoffRetryRunner', () => {
  it('op exitosa al primer intento -> no retry', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const op = vi.fn(async () => 'ok');
    const result = await runner.run(op, buildOpts());
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledWith(1);
  });

  it('RateLimitedError -> retry; retryAfterMs preservado al backoff', async () => {
    const backoff: IBackoff = { nextDelayMs: vi.fn().mockReturnValue(50_000) };
    const runner = new BackoffRetryRunner(noopSleeper);
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new RateLimitedError(30_000, '429!');
      return 'ok';
    });

    const result = await runner.run(op, buildOpts({ backoff, maxAttempts: 3 }));
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
    expect(backoff.nextDelayMs).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ retryAfterMs: 30_000 }),
    );
  });

  it('TransientHttpError 502 -> retry', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new TransientHttpError(502, 'Bad Gateway');
      return 'ok';
    });
    const result = await runner.run(op, buildOpts({ maxAttempts: 3 }));
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('Error no reintentable -> throw sin retry', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const op = vi.fn(async () => {
      throw new Error('not retryable');
    });
    const isRetryable = () => false;
    await expect(runner.run(op, buildOpts({ isRetryable }))).rejects.toThrow(
      'not retryable',
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('presupuesto agotado -> throw last error', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const op = vi.fn(async () => {
      throw new RateLimitedError(null, 'always 429');
    });
    await expect(
      runner.run(op, buildOpts({ maxAttempts: 3 })),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('custom budget: maxAttempts=2 -> max 2 intentos', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const op = vi.fn(async () => {
      throw new TransientHttpError(503, 'down');
    });
    await expect(
      runner.run(op, buildOpts({ maxAttempts: 2 })),
    ).rejects.toBeInstanceOf(TransientHttpError);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('default budget=5 -> max 5 intentos', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const op = vi.fn(async () => {
      throw new RateLimitedError(null, 'always 429');
    });
    await expect(
      runner.run(op, buildOpts({ maxAttempts: 5 })),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(op).toHaveBeenCalledTimes(5);
  });

  it('onRetry hook se llama con attempt + delayMs + error antes de cada sleep', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const onRetry = vi.fn();
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new RateLimitedError(1_000, 'throttled');
      return 'ok';
    });
    const result = await runner.run(
      op,
      buildOpts({ backoff: constantBackoff(2_500), maxAttempts: 3, onRetry }),
    );
    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      delayMs: 2_500,
      error: expect.any(RateLimitedError),
    });
    expect(onRetry).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      delayMs: 2_500,
      error: expect.any(RateLimitedError),
    });
  });

  it('usa el sleeper del constructor y no setTimeout real', async () => {
    const sleepMock = vi.fn(noopSleeper);
    const runner = new BackoffRetryRunner(sleepMock);
    const op = vi.fn(async () => {
      throw new RateLimitedError(null, 'throttled');
    });
    await expect(
      runner.run(op, buildOpts({ maxAttempts: 2 })),
    ).rejects.toBeInstanceOf(RateLimitedError);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(0);
  });

  it('rechaza maxAttempts < 1', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    await expect(
      runner.run(async () => 'x', buildOpts({ maxAttempts: 0 })),
    ).rejects.toThrow(/maxAttempts/);
  });

  it('onRetry que lanza no tumba el retry loop', async () => {
    const runner = new BackoffRetryRunner(noopSleeper);
    const onRetry = vi.fn(() => {
      throw new Error('hook boom');
    });
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new RateLimitedError(null, 'throttled');
      return 'ok';
    });
    const result = await runner.run(
      op,
      buildOpts({ maxAttempts: 2, onRetry }),
    );
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });
});