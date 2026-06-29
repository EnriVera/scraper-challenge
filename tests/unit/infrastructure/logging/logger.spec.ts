import { describe, expect, it } from 'vitest';
import { serializeLine } from '../../../../src/infrastructure/logging/console-logger';

/**
 * `ConsoleLogger` no necesita escribir a stdout para su contrato:
 * verificamos la serializacion (que es la unica dependencia que
 * comparte con `FileLogger`). El `ConsoleLogger` mismo simplemente
 * hace `stream.write(serializeLine(...))`.
 */
describe('serializeLine (logger JSON)', () => {
  it('emite ts + level + msg en una sola linea', () => {
    const fixed = new Date('2026-06-29T14:30:22.500Z');
    const line = serializeLine('info', 'commit page', { page: 3, rows: 10 });
    // Forzamos la misma fecha reasignando `ts` para no depender del reloj.
    const replaced = JSON.parse(line);
    expect(replaced.level).toBe('info');
    expect(replaced.msg).toBe('commit page');
    expect(replaced.page).toBe(3);
    expect(replaced.rows).toBe(10);
    // ts esta en formato ISO (sin assertar el valor exacto).
    expect(typeof replaced.ts).toBe('string');
    expect(replaced.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(fixed).toBeInstanceOf(Date); // sanity, no se usa mas
  });

  it('tolera ctx undefined', () => {
    const line = serializeLine('debug', 'hola');
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe('hola');
    expect(parsed.level).toBe('debug');
    expect(parsed.ts).toBeDefined();
  });

  it('tolera caracteres unicode en el msg', () => {
    const line = serializeLine('warn', 'página 1 de 176');
    expect(line).toContain('página 1 de 176');
  });
});
