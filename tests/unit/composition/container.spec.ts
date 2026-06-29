import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContainer } from '../../../src/composition/container';
import { NoopLogger, SpyLogger } from '../support/noop-logger';

describe('buildContainer', () => {
  let tmpDataDir: string;

  beforeEach(async () => {
    tmpDataDir = await mkdtemp(join(tmpdir(), 'scraper-test-'));
  });

  afterEach(async () => {
    await rm(tmpDataDir, { recursive: true, force: true });
  });

  it('crea directorios json/, pdfs/, logs/ al construir', async () => {
    await buildContainer({
      sector: 'TODOS',
      maxPdfs: 'unlimited',
      retries: 5,
      concurrency: 1,
      dataDir: tmpDataDir,
      delayBetweenRequestsMs: 500,
      startedAt: new Date('2026-06-29T12:00:00Z'),
      logger: new NoopLogger(),
    });

    const dirs = await readdir(tmpDataDir);
    expect(dirs.sort()).toEqual(['json', 'logs', 'pdfs'].sort());
  });

  it('expone todos los use cases del container', async () => {
    const c = await buildContainer({
      sector: 'PESQUERIA',
      maxPdfs: 20,
      retries: 5,
      concurrency: 1,
      dataDir: tmpDataDir,
      delayBetweenRequestsMs: 500,
      startedAt: new Date('2026-06-29T12:00:00Z'),
      logger: new NoopLogger(),
    });

    expect(c.scrape).toBeDefined();
    expect(c.download).toBeDefined();
    expect(c.retry).toBeDefined();
    expect(c.runFull).toBeDefined();
    expect(typeof c.shutdown).toBe('function');
  });

  it('concurrency>1 emite warning y clampea a 1', async () => {
    const logger = new SpyLogger();
    const c = await buildContainer({
      sector: 'TODOS',
      maxPdfs: 'unlimited',
      retries: 5,
      concurrency: 4, // <-- invalido
      dataDir: tmpDataDir,
      delayBetweenRequestsMs: 500,
      startedAt: new Date(),
      logger,
    });

    // Debe haber un warning relacionado a concurrency.
    const warn = logger.calls.find(
      (c) => c.level === 'warn' && c.msg.includes('concurrency'),
    );
    expect(warn).toBeDefined();

    // Y el container funciona (no explota).
    expect(c.runFull).toBeDefined();
  });

  it('logger por default crea un archivo de log en data/logs/<ISO8601>.log', async () => {
    const c = await buildContainer({
      sector: 'TODOS',
      maxPdfs: 'unlimited',
      retries: 5,
      concurrency: 1,
      dataDir: tmpDataDir,
      delayBetweenRequestsMs: 500,
      startedAt: new Date('2026-06-29T14:30:22Z'),
      // sin `logger` -> usa el TeeLogger interno
    });

    // Emitir un mensaje via el logger del container.
    c.logger.info('hello world', { test: true });

    // Esperar un microtick para que el appendFileSync se complete.
    await new Promise((r) => setImmediate(r));

    const logsDir = join(tmpDataDir, 'logs');
    const files = await readdir(logsDir);
    expect(files.length).toBe(1);
    const content = await readFile(join(logsDir, files[0]), 'utf8');
    expect(content).toContain('hello world');
    expect(content).toContain('"level":"info"');
  });
});