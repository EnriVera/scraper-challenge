import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileLogger } from '../../../../src/infrastructure/logging/file-logger';

/**
 * FileLogger escribe a `<file>.log` cada llamada, una linea JSON.
 * Cubre la `I`-prefijo del port (`ILogger`) y el formato de linea
 * que el caso de uso de scrape va a producir.
 */
describe('FileLogger', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oefa-file-log-'));
    logPath = join(dir, 'run.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('crea el directorio padre si no existe', () => {
    const nested = join(dir, 'logs', '2026-06-29', 'run.log');
    new FileLogger(nested);
    const { statSync } = require('node:fs');
    expect(statSync(dirname(nested)).isDirectory()).toBe(true);

    function dirname(p: string): string {
      const idx = p.lastIndexOf('/');
      return idx === -1 ? p : p.slice(0, idx);
    }
  });

  it('escribe una linea JSON por llamada con ts/level/msg/ctx', () => {
    const log = new FileLogger(logPath);
    log.info('commit page', { page: 3, rows: 10 });
    log.warn('rate-limit', { retryAfterMs: 1500 });

    const raw = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(raw).toHaveLength(2);

    const first = JSON.parse(raw[0]);
    expect(first.level).toBe('info');
    expect(first.msg).toBe('commit page');
    expect(first.page).toBe(3);
    expect(first.rows).toBe(10);
    expect(typeof first.ts).toBe('string');

    const second = JSON.parse(raw[1]);
    expect(second.level).toBe('warn');
    expect(second.msg).toBe('rate-limit');
    expect(second.retryAfterMs).toBe(1500);
  });

  it('append-only: no sobrescribe entre llamadas (cada linea es nuevo evento)', () => {
    const log = new FileLogger(logPath);
    log.info('uno');
    log.info('dos');
    log.info('tres');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(['uno', 'dos', 'tres']);
  });
});
