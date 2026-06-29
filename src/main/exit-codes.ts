/**
 * Helpers para mapear errores a exit codes del proceso.
 * Ver `design.md §6.3`:
 *   0 - completed (incluso con fallidos residuales)
 *   2 - bootstrap GET non-2xx (fatal)
 *   3 - invalid CLI input
 *   4 - MalformedHtmlError (AJAX headers leak)
 */
import {
  MalformedHtmlError,
  RateLimitedError,
  TransientHttpError,
  ViewStateExpiredError,
} from '../domain/errors';
import { InvalidCliInputError } from './config';

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export function exitCodeFor(err: unknown): ExitCode {
  if (err instanceof InvalidCliInputError) return 3;
  if (err instanceof MalformedHtmlError) return 4;
  if (err instanceof ViewStateExpiredError) return 2;
  if (err instanceof RateLimitedError) return 2;
  if (err instanceof TransientHttpError) return 2;
  if (err instanceof Error && /status\s+5\d{2}/i.test(err.message)) return 2;
  // Otros errores: por seguridad exit 1.
  return 1;
}

/**
 * Indirector sobre `process.exit`. Tests pueden reasignar este
 * puntero para capturar exit codes sin matar el runner.
 */
let exitFn: (code: number) => never = (code) => process.exit(code);

/** Solo para tests. */
export function __setExitFn(fn: (code: number) => never): void {
  exitFn = fn;
}

export function processExit(code: number): never {
  return exitFn(code);
}