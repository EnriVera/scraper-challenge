import { describe, it, expect } from 'vitest';
import { parseArgs, InvalidCliInputError } from '../../../src/main/config';
import { handleError } from '../../../src/main/cli';
import { buildContainer } from '../../../src/composition/container';
import { SpyLogger } from '../support/noop-logger';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parseArgs', () => {
  it('default sector es TODOS', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape']);
    expect(cfg.sector).toBe('TODOS');
    expect(cfg.maxPdfs).toBe('unlimited');
    expect(cfg.retries).toBe(5);
    expect(cfg.concurrency).toBe(1);
  });

  it('sector PESQUERIA se acepta', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--sector', 'PESQUERIA']);
    expect(cfg.sector).toBe('PESQUERIA');
  });

  it('sector invalido lanza InvalidCliInputError', () => {
    expect(() =>
      parseArgs(['node', 'cli', 'scrape', '--sector', 'AGRICULTURA']),
    ).toThrow(InvalidCliInputError);
  });

  it('--concurrency 4 se clampea a 1', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--concurrency', '4']);
    expect(cfg.concurrency).toBe(1);
  });

  it('--concurrency 8 en container emite exactamente 1 warning con requested=8 y clamped=1 (spec §Clamp warning)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cfg-w3-'));
    try {
      const logger = new SpyLogger();
      await buildContainer({
        sector: 'TODOS',
        maxPdfs: 'unlimited',
        retries: 5,
        concurrency: 8,
        dataDir: dir,
        delayBetweenRequestsMs: 500,
        startedAt: new Date(),
        logger,
      });
      const concurrencyWarns = logger.calls.filter(
        (c) => c.level === 'warn' && c.msg.toLowerCase().includes('concurrency'),
      );
      expect(concurrencyWarns).toHaveLength(1);
      expect(concurrencyWarns[0].msg).toContain('8');
      expect(concurrencyWarns[0].msg).toContain('1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

it('handleError: VITEST=true suprime el banner de commander (spec §VITEST hides banner)', () => {
    const originalVitest = process.env.VITEST;
    const originalWrite = process.stderr.write;
    const originalExit = process.exit;
    let stderrBuf = '';
    let exitCode = -1;

    process.env.VITEST = 'true';
    process.stderr.write = ((s: string) => {
      stderrBuf += s;
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;

    try {
      handleError(new InvalidCliInputError('test error message'));
      expect(stderrBuf).toContain('error: test error message');
      expect(stderrBuf).not.toContain('Uso: scraper-oefa');
      expect(exitCode).toBe(3);
    } finally {
      if (originalVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = originalVitest;
      process.stderr.write = originalWrite;
      process.exit = originalExit;
    }
  });

  it('handleError: VITEST unset mantiene el banner de commander (spec §VITEST unset preserves banner)', () => {
    const originalVitest = process.env.VITEST;
    const originalWrite = process.stderr.write;
    const originalExit = process.exit;
    let stderrBuf = '';
    let exitCode = -1;

    delete process.env.VITEST;
    process.stderr.write = ((s: string) => {
      stderrBuf += s;
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code: number) => {
      exitCode = code;
      return undefined as never;
    }) as typeof process.exit;

    try {
      handleError(new InvalidCliInputError('test error message'));
      expect(stderrBuf).toContain('error: test error message');
      expect(stderrBuf).toContain('Uso: scraper-oefa');
      expect(exitCode).toBe(3);
    } finally {
      if (originalVitest !== undefined) process.env.VITEST = originalVitest;
      process.stderr.write = originalWrite;
      process.exit = originalExit;
    }
  });

  it('--max-pdfs unlimited se acepta', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--max-pdfs', 'unlimited']);
    expect(cfg.maxPdfs).toBe('unlimited');
  });

  it('--max-pdfs 20 se acepta como numero', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--max-pdfs', '20']);
    expect(cfg.maxPdfs).toBe(20);
  });

  it('--pages 2 -> maxPaginas=2', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--pages', '2']);
    expect(cfg.maxPaginas).toBe(2);
  });

  it('--pages -1 -> InvalidCliInputError', () => {
    expect(() => parseArgs(['node', 'cli', 'scrape', '--pages', '-1'])).toThrow(
      InvalidCliInputError,
    );
  });

  it('--retries 2 -> retries=2', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--retries', '2']);
    expect(cfg.retries).toBe(2);
  });

  it('--data-dir custom', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--data-dir', '/tmp/foo']);
    expect(cfg.dataDir).toBe('/tmp/foo');
  });

  it('todos los sectores validos se aceptan', () => {
    const sectors = ['TODOS', 'MINERIA', 'ELECTRICIDAD', 'HIDROCARBUROS', 'INDUSTRIA', 'PESQUERIA'];
    for (const s of sectors) {
      const cfg = parseArgs(['node', 'cli', 'scrape', '--sector', s]);
      expect(cfg.sector).toBe(s);
    }
  });
});