import type { ILogger } from '../../domain/ports';

/**
 * Logger que escribe a stdout/stderr segun el nivel:
 *   - debug/info -> stdout
 *   - warn       -> stdout (con prefijo visual)
 *   - error      -> stderr
 *
 * Cada linea es JSON: `{ "ts": "...", "level": "...", "msg": "...", ...ctx }`.
 * Esto permite `npm run scrape 2>&1 | jq '.msg'` y reutilizar el mismo
 * parser en test/E2E.
 */
export class ConsoleLogger implements ILogger {
  private readonly stream: NodeJS.WritableStream;

  constructor(opts: { stderr?: boolean } = {}) {
    this.stream = opts.stderr ? process.stderr : process.stdout;
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.write('debug', msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.write('info', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.write('warn', msg, ctx);
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.write('error', msg, ctx);
  }

  private write(level: string, msg: string, ctx?: Record<string, unknown>): void {
    const line = `${serializeLine(level, msg, ctx)}\n`;
    this.stream.write(line);
  }
}

export function serializeLine(
  level: string,
  msg: string,
  ctx?: Record<string, unknown>,
): string {
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx ?? {}),
  };
  return JSON.stringify(line);
}
