/**
 * Logger estructurado del scraper. Una linea por mensaje en JSON:
 *   { ts, level, msg, ...ctx }
 *
 * Los adapters `ConsoleLogger` (stdout/stderr por nivel) y
 * `FileLogger` (append a `data/logs/<timestamp>.log`) viven en
 * `infrastructure/logging/`.
 */
export interface ILogger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}