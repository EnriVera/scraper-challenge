import { describe, it, expect } from 'vitest';
import { PLimitScheduler } from '../../../../src/infrastructure/retry/plimit-scheduler';

describe('PLimitScheduler', () => {
  it('dos tareas se ejecutan secuencialmente con concurrency=1', async () => {
    const scheduler = new PLimitScheduler(1);
    const events: string[] = [];

    const a = scheduler.schedule(async () => {
      events.push('a-start');
      await new Promise((r) => setTimeout(r, 30));
      events.push('a-end');
      return 'A';
    });
    const b = scheduler.schedule(async () => {
      events.push('b-start');
      await new Promise((r) => setTimeout(r, 10));
      events.push('b-end');
      return 'B';
    });

    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe('A');
    expect(rb).toBe('B');
    // Secuencia esperada: a-start, a-end, b-start, b-end
    // (concurrency=1 garantiza que b-start no ocurra antes de a-end).
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('concurrency=3 permite hasta 3 tareas en paralelo', async () => {
    const scheduler = new PLimitScheduler(3);
    let active = 0;
    let maxActive = 0;

    const task = () =>
      scheduler.schedule(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return active;
      });

    await Promise.all([task(), task(), task(), task(), task()]);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThanOrEqual(2); // al menos 2 en paralelo
  });

  it('rechaza concurrency < 1', () => {
    expect(() => new PLimitScheduler(0)).toThrow();
    expect(() => new PLimitScheduler(-1)).toThrow();
    expect(() => new PLimitScheduler(1.5)).toThrow();
  });

  it('propaga errores de la tarea', async () => {
    const scheduler = new PLimitScheduler(1);
    await expect(
      scheduler.schedule(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('despues de un error la siguiente tarea corre (no queda locked)', async () => {
    const scheduler = new PLimitScheduler(1);
    await expect(
      scheduler.schedule(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    const result = await scheduler.schedule(async () => 'ok');
    expect(result).toBe('ok');
  });
});