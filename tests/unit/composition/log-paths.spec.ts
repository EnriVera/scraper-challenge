import { describe, expect, it } from 'vitest';
import { buildLogPath, formatIsoCompact } from '../../../src/composition/log-paths';

/**
 * Cubre `specs/persistencia-datos §Log Rotation Per Run`:
 *   - path usa `<dataDir>/logs/<stamp>.log`
 *   - stamp es ISO8601 compact en UTC
 *   - dos instantes distintos producen archivos distintos (no overwrite)
 */
describe('log-paths', () => {
  it('buildLogPath compone data/logs/<stamp>.log', () => {
    const stamp = '2026-06-29T143022Z';
    const got = buildLogPath(new Date('2026-06-29T14:30:22Z'), 'data');
    expect(got).toBe(`data/logs/${stamp}.log`);
  });

  it('buildLogPath respeta el dataDir recibido', () => {
    const got = buildLogPath(new Date('2026-06-29T14:30:22Z'), '/tmp/oefa');
    expect(got).toBe('/tmp/oefa/logs/2026-06-29T143022Z.log');
  });

  it('formatIsoCompact emite UTC en formato YYYY-MM-DDTHHMMSSZ', () => {
    const fixed = new Date('2026-06-29T14:30:22.500Z');
    expect(formatIsoCompact(fixed)).toBe('2026-06-29T143022Z');
  });

  it('formatIsoCompact acepta cualquier TZ y devuelve UTC', () => {
    // Buenos Aires en 11:30 local -> 14:30 UTC.
    const local = new Date('2026-06-29T11:30:22-03:00');
    expect(formatIsoCompact(local)).toBe('2026-06-29T143022Z');
  });

  it('dos instantes producen dos stamps diferentes (no overwrite)', () => {
    const a = new Date('2026-06-29T14:30:21Z');
    const b = new Date('2026-06-29T14:30:22Z');
    expect(buildLogPath(a, 'data')).not.toBe(buildLogPath(b, 'data'));
  });

  it('rellenar con ceros a la izquierda para mes/dia/hora/minuto/seg', () => {
    // 1 de enero a las 05:05:05 UTC.
    const d = new Date('2026-01-01T05:05:05Z');
    expect(formatIsoCompact(d)).toBe('2026-01-01T050505Z');
  });
});
