import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStats } from '../../../src/main/cmd-stats';
import { parseArgs } from '../../../src/main/config';
import { __setExitFn } from '../../../src/main/exit-codes';

/**
 * Tests del sub-comando `stats` (incluye el nuevo modo `--verbose`
 * introducido en `post-entrega-polish §S3`).
 *
 * Capturamos stdout reasignando `process.stdout.write` y los exit codes
 * via `__setExitFn`. NO se hace HTTP real: todos los tests usan
 * archivos locales en un directorio temporal.
 */

describe('cmd-stats --verbose', () => {
  let tmpDataDir: string;
  let capturedExit: number | null = null;
  let originalStdoutWrite: typeof process.stdout.write;
  let stdoutBuf = '';

  beforeEach(async () => {
    tmpDataDir = await mkdtemp(join(tmpdir(), 'cmd-stats-verbose-'));
    capturedExit = null;
    stdoutBuf = '';
    __setExitFn((code: number) => {
      capturedExit = code;
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

  it('--verbose prints sorted status breakdown (spec §--verbose prints sorted)', async () => {
    const jsonDir = join(tmpDataDir, 'json');
    await mkdir(jsonDir, { recursive: true });
    // Mezcla de status para forzar orden alfabetico.
    const docs = [
      { documento: { nro: '1' }, status: 'ok', pdfPath: null },
      { documento: { nro: '2' }, status: 'ok', pdfPath: null },
      { documento: { nro: '3' }, status: '429_agotado', pdfPath: null },
      { documento: { nro: '4' }, status: 'magic_bytes_invalidos', pdfPath: null },
      { documento: { nro: '5' }, status: 'http_500', pdfPath: null },
    ];
    await writeFile(join(jsonDir, 'documentos.json'), JSON.stringify(docs), 'utf8');
    // Tambien stats.json (sin esto runStats devuelve warning primero).
    await writeFile(
      join(jsonDir, 'stats.json'),
      JSON.stringify({
        runId: 'r',
        startedAt: '2026-06-29T00:00:00Z',
        paginasProcesadas: 1,
        totalPaginas: 1,
        documentosOk: 2,
        documentosFallidos: 3,
        documentosPendientes: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 2,
        reintentosTotales: 0,
      }),
      'utf8',
    );

    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir]);
    await runStats(cfg, 'json', true);

    expect(capturedExit).toBe(0);
    // Las 4 lineas de breakdown, ordenadas alfabeticamente.
    expect(stdoutBuf).toContain('status=429_agotado: 1');
    expect(stdoutBuf).toContain('status=http_500: 1');
    expect(stdoutBuf).toContain('status=magic_bytes_invalidos: 1');
    expect(stdoutBuf).toContain('status=ok: 2');
    // El orden debe ser alfabetico por status key.
    const idx429 = stdoutBuf.indexOf('status=429_agotado');
    const idx500 = stdoutBuf.indexOf('status=http_500');
    const idxMagic = stdoutBuf.indexOf('status=magic_bytes_invalidos');
    const idxOk = stdoutBuf.indexOf('status=ok');
    expect(idx429).toBeLessThan(idx500);
    expect(idx500).toBeLessThan(idxMagic);
    expect(idxMagic).toBeLessThan(idxOk);
  });

  it('--verbose on missing documentos.json emits status=ok: 0 only (spec §missing is safe)', async () => {
    const jsonDir = join(tmpDataDir, 'json');
    await mkdir(jsonDir, { recursive: true });
    // NO creamos documentos.json, solo stats.json.
    await writeFile(
      join(jsonDir, 'stats.json'),
      JSON.stringify({
        runId: 'r',
        startedAt: '2026-06-29T00:00:00Z',
        paginasProcesadas: 0,
        totalPaginas: 0,
        documentosOk: 0,
        documentosFallidos: 0,
        documentosPendientes: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 0,
        reintentosTotales: 0,
      }),
      'utf8',
    );

    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir]);
    await runStats(cfg, 'json', true);

    expect(capturedExit).toBe(0);
    expect(stdoutBuf).toContain('status=ok: 0');
  });

  it('no --verbose produces summary only (no breakdown)', async () => {
    const jsonDir = join(tmpDataDir, 'json');
    await mkdir(jsonDir, { recursive: true });
    const docs = [
      { documento: { nro: '1' }, status: 'ok', pdfPath: null },
      { documento: { nro: '2' }, status: '429_agotado', pdfPath: null },
    ];
    await writeFile(join(jsonDir, 'documentos.json'), JSON.stringify(docs), 'utf8');
    await writeFile(
      join(jsonDir, 'stats.json'),
      JSON.stringify({
        runId: 'r',
        startedAt: '2026-06-29T00:00:00Z',
        paginasProcesadas: 1,
        totalPaginas: 1,
        documentosOk: 1,
        documentosFallidos: 1,
        documentosPendientes: 0,
        pdfsSaltados: 0,
        pdfsDescargados: 1,
        reintentosTotales: 0,
      }),
      'utf8',
    );

    const cfg = parseArgs(['node', 'cli', 'stats', '--data-dir', tmpDataDir]);
    await runStats(cfg, 'json', false);

    expect(capturedExit).toBe(0);
    expect(stdoutBuf).not.toContain('status=429_agotado');
    expect(stdoutBuf).not.toContain('status=ok:');
  });
});