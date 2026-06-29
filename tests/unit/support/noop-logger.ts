import type { ILogger } from '../../../../src/domain/ports';

/**
 * Logger que descarta todo. Util para tests donde no queremos
 * contaminar stdout con JSON lines, pero la API exige un ILogger.
 */
export class NoopLogger implements ILogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

/**
 * Logger spy: registra todas las llamadas en memoria para aserciones.
 */
export class SpyLogger implements ILogger {
  readonly calls: { level: string; msg: string; ctx?: Record<string, unknown> }[] = [];
  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.calls.push({ level: 'debug', msg, ctx });
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.calls.push({ level: 'info', msg, ctx });
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.calls.push({ level: 'warn', msg, ctx });
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.calls.push({ level: 'error', msg, ctx });
  }
}