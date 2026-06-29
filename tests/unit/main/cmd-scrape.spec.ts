import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStats } from '../../../src/main/cmd-stats';
import { runRetry } from '../../../src/main/cmd-retry';
import { runScrape } from '../../../src/main/cmd-scrape';
import { parseArgs } from '../../../src/main/config';
import { __setExitFn } from '../../../src/main/exit-codes';

/**
 * Tests E2E del CLI (control flow only). NO mockeamos axios — para
 * evitar HTTP real, validamos solo:
 *   - `runStats` con/sin stats.json: formato JSON y table.
 *   - `runRetry` con directorio vacio: exit 0.
 *   - `runScrape` crea logs/ antes de intentar HTTP.
 *
 * Capturamos exit codes reasignando `processExit` via `__setExitFn`.
 */

describe('CLI control-flow', () => {
  let tmpDataDir: string;
  let capturedExit: number | null = null;
  let originalStdoutWrite: typeof process.stdout.write;
  let stdoutBuf = '';

  beforeEach(async () => {
    tmpDataDir = await mkdtemp(join(tmpdir(), 'scraper-cli-test-'));
    capturedExit = null;
    stdoutBuf = '';
    __setExitFn((code: number) => {
      capturedExit = code;
      // Devolvemos undefined como `never` via cast; nunca se usa el return.
      return undefined as never;
    });
    originalStdoutWrite = process.stdout.write;
    (process.stdout.write as unknown as (s: string) => boolean) = (s: string) => {
      stdoutBuf += s;
      return true;
    };
  });

  afterEach(async () => {
    __setExitFn((code: number) => process.exit(code));
    process.stdout.write = originalStdoutWrite;
    await rm(tmpDataDir, { recursive: true, force: true });
  });

  it('runStats con directorio vacio -> exit 0 y warning', async () => {
    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir]);
    await runStats(cfg);

    expect(capturedExit).toBe(0);
    expect(stdoutBuf).toContain('no se encontro data/json/stats.json');
  });

  it('runRetry con directorio vacio -> exit 0, todos los contadores en 0', async () => {
    const cfg = parseArgs(['node', 'cli', 'retry', '--data-dir', tmpDataDir]);
    await runRetry(cfg);

    expect(capturedExit).toBe(0);
    const parsed = extractLastJsonObject(stdoutBuf) as {
      pdfsOk: number; pdfsFallidos: number; pending: number;
    } | null;
    expect(parsed).not.toBeNull();
    expect(parsed!.pdfsOk).toBe(0);
    expect(parsed!.pdfsFallidos).toBe(0);
    expect(parsed!.pending).toBe(0);
  });

  it('runStats con stats.json precargado lee y formatea JSON', async () => {
    await mkdir(join(tmpDataDir, 'json'), { recursive: true });
    await writeFile(
      join(tmpDataDir, 'json', 'stats.json'),
      JSON.stringify({
        runId: 'r1',
        startedAt: '2026-06-29T12:00:00Z',
        finishedAt: '2026-06-29T12:30:00Z',
        paginasProcesadas: 1,
        totalPaginas: 1,
        documentosOk: 5,
        documentosFallidos: 1,
        documentosPendientes: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 5,
        reintentosTotales: 0,
      }),
      'utf8',
    );

    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir]);
    await runStats(cfg, 'json');

    expect(capturedExit).toBe(0);
    expect(stdoutBuf).toContain('"documentosOk": 5');
  });

  it('runStats con --format table imprime formato tabla', async () => {
    await mkdir(join(tmpDataDir, 'json'), { recursive: true });
    await writeFile(
      join(tmpDataDir, 'json', 'stats.json'),
      JSON.stringify({
        runId: 'r1',
        startedAt: '2026-06-29T12:00:00Z',
        finishedAt: '2026-06-29T12:30:00Z',
        paginasProcesadas: 1,
        totalPaginas: 1,
        documentosOk: 5,
        documentosFallidos: 1,
        documentosPendientes: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 5,
        reintentosTotales: 0,
      }),
      'utf8',
    );

    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir, '--format', 'table']);
    await runStats(cfg, 'table');

    expect(capturedExit).toBe(0);
    expect(stdoutBuf).toContain('documentosOk');
    expect(stdoutBuf).not.toContain('"documentosOk"');
  });

  it('runScrape crea data/logs/<stamp>.log ANTES de intentar HTTP', async () => {
    // Sin red, el bootstrap falla. Pero `FileLogger` ya esta creado
    // en `buildContainer` -> el archivo de log existe antes del primer
    // HTTP call. No esperamos a que termine: solo validamos el side-
    // effect colateral del constructor del container.
    const cfg = parseArgs(['node', 'cli', 'scrape', '--data-dir', tmpDataDir, '--sector', 'TODOS']);

    // Disparamos y dejamos correr hasta 1s, luego matamos.
    const promise = runScrape(cfg).catch(() => undefined);
    await Promise.race([
      promise,
      new Promise((r) => setTimeout(r, 800)),
    ]);

    const logs = await readdir(join(tmpDataDir, 'logs'));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const s = await stat(join(tmpDataDir, 'logs', logs[0]));
    expect(s.size).toBeGreaterThan(0);
  });
});

/**
 * Extrae el ultimo objeto JSON balanceado de un buffer. Util cuando
 * stdout contiene log lines mezcladas con JSON output.
 */
function extractLastJsonObject(buf: string): unknown {
  const candidates = buf.match(/\{[\s\S]*?\}/g) ?? [];
  for (const c of candidates.reverse()) {
    try {
      return JSON.parse(c);
    } catch {
      // try next
    }
  }
  return null;
}