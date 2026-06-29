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

  it('devuelve null para valores no numericos (HTTP-date o basura)', () => {
    // Sin parser de HTTP-date por ahora (design §10 issue 3).
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfter('not-a-number')).toBeNull();
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
});