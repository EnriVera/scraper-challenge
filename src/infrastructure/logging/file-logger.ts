import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ILogger } from '../../domain/ports';
import { serializeLine } from './console-logger';

/**
 * Logger que escribe una linea JSON por mensaje a `data/logs/<run>.log`.
 *
 * Cada linea: `{ "ts": "...", "level": "...", "msg": "...", ...ctx }`.
 *
 * `specs/persistencia-datos §Log Rotation Per Run` exige un archivo NUEVO
 * por corrida; el composition se encarga de generar el path
 * (`composition/log-paths.ts`); este adapter solo escribe append-only.
 */
export class FileLogger implements ILogger {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.append('debug', msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.append('info', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.append('warn', msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.append('error', msg, ctx);
  }

  private append(level: string, msg: string, ctx?: Record<string, unknown>): void {
    appendFileSync(this.filePath, `${serializeLine(level, msg, ctx)}\n`, 'utf8');
  }
}
