import { describe, it, expect } from 'vitest';
import { parseRetryAfter } from '../../../../src/infrastructure/http/parse-retry-after';

describe('parseRetryAfter', () => {
  it('parsea segundos enteros a milisegundos', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('1')).toBe(1000);
    expect(parseRetryAfter('120')).toBe(120_000);
  });

  it('parsea segundos con espacios alrededor', () => {
    expect(parseRetryAfter('  45  ')).toBe(45_000);
  });

  it('clamp a 120 segundos cuando el valor lo excede', () => {
    expect(parseRetryAfter('600')).toBe(120_000);
    expect(parseRetryAfter('9999')).toBe(120_000);
  });

  it('devuelve null para header undefined', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('devuelve null para header vacio o solo espacios', () => {
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('   ')).toBeNull();
  });

  it('trunca fracciones a milisegundos enteros', () => {
    expect(parseRetryAfter('1.5')).toBe(1500);
    expect(parseRetryAfter('0.25')).toBe(250);
  });

  it('0 segundos da 0 ms (valor valido)', () => {
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('numeros negativos devuelven null', () => {
    // No es un valor valido; caemos al fallback del backoff.
    expect(parseRetryAfter('-5')).toBeNull();
  });

  it('HTTP-date futura devuelve ms positivos hasta la fecha objetivo (spec §HTTP-date is parsed)', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:27:30 GMT');
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', now)).toBe(30_000);
  });

  it('HTTP-date en el pasado devuelve 0 ms (spec §Past returns 0)', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', now)).toBe(0);
  });

  it('HTTP-date con delta > 120s se clampea a 120000 ms (spec §Exceeds cap is clamped)', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:00:00 GMT');
    // 10 minutos en el futuro -> debe clampear.
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:10:00 GMT', now)).toBe(120_000);
  });

  it('HTTP-date malformada devuelve null y el backoff hace fallback (spec §Malformed falls back)', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(parseRetryAfter('not-a-date', now)).toBeNull();
    expect(parseRetryAfter('Wed, 99 Oct 9999 99:99:99 GMT', now)).toBeNull();
  });
});