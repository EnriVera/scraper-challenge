#!/usr/bin/env node
/**
 * Entry point CLI. Ver `design.md §6`.
 *
 * Sub-comandos:
 *   scrape  --sector <S> --pages <N> --max-pdfs <M>
 *   retry   --max-pdfs <N>
 *   stats   [--format table]
 *
 * Exit codes (per `design.md §6.3`):
 *   0 - success / completed
 *   2 - bootstrap fatal (e.g. ViewStateExpiredError tras re-bootstrap)
 *   3 - invalid CLI input
 *   4 - MalformedHtmlError (AJAX headers leak)
 */
import { Command } from 'commander';
import { parseArgs, InvalidCliInputError } from './config';
import { runScrape } from './cmd-scrape';
import { runRetry } from './cmd-retry';
import { runStats } from './cmd-stats';
import { exitCodeFor } from './exit-codes';

const program = new Command();
program
  .name('scraper-oefa')
  .description('Scraper OEFA — TypeScript, sin browser automation')
  .version('0.1.0');

program
  .command('scrape')
  .description('Ejecuta la pipeline completa (scrape + download + stats)')
  .option('--sector <SECTOR>', 'filtrar por sector (default TODOS)')
  .option('--pages <N>', 'limitar paginas a iterar')
  .option('--max-pdfs <N|unlimited>', 'cap de PDFs (default unlimited)')
  .option('--retries <N>', 'intentos por PDF (default 5)')
  .option('--concurrency <N>', 'concurrencia (forzado a 1)')
  .option('--delay-ms <N>', 'delay entre requests en ms (default 500)')
  .option('--data-dir <PATH>', 'directorio de datos (default data)')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cfg = parseArgs(['node', 'cli', 'scrape', ...flagPairs(opts)]);
      await runScrape(cfg);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('retry')
  .description('Re-intenta las filas en fallidos.json')
  .option('--max-pdfs <N>', 'cap de PDFs (default unlimited)')
  .option('--data-dir <PATH>', 'directorio de datos (default data)')
  .option('--sector <SECTOR>', 'placeholder para reutilizar parseArgs')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cfg = parseArgs(['node', 'cli', 'retry', ...flagPairs(opts)]);
      await runRetry(cfg);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('stats')
  .description('Lee stats.json + fallidos.json y emite resumen')
  .option('--format <FORMAT>', 'json|table', 'json')
  .option('--data-dir <PATH>', 'directorio de datos (default data)')
  .option('--verbose', 'dump status breakdown from documentos.json')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const cfg = parseArgs(['node', 'cli', 'stats', ...flagPairs(opts)]);
      const format = (opts.format as 'json' | 'table') ?? 'json';
      const verbose = Boolean(opts.verbose);
      await runStats(cfg, format, verbose);
    } catch (err) {
      handleError(err);
    }
  });

/**
 * Convierte `{ sector: 'TODOS' }` en `['--sector', 'TODOS']`.
 * Commander pasa un objeto plano con los valores parseados.
 */
function flagPairs(opts: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(opts)) {
    if (v === undefined || v === null) continue;
    out.push(`--${kebab(k)}`);
    out.push(String(v));
  }
  return out;
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Maneja errores thrown por el CLI. En modo test (VITEST=true|1)
 * suprime el banner `\nUso: ...` para mantener el output del test
 * legible (ver `specs/repo-hygiene §Commander Banner Suppressed In
 * Test Runner`). Solo afecta la rama `InvalidCliInputError`; los
 * errores de runtime siguen emitiendo su mensaje completo a stderr.
 *
 * Exportada para tests.
 */
export function handleError(err: unknown): void {
  if (err instanceof InvalidCliInputError) {
    process.stderr.write(`error: ${err.message}\n`);
    const isTest = process.env.VITEST === 'true' || process.env.VITEST === '1';
    if (!isTest) {
      process.stderr.write(`\nUso: scraper-oefa scrape|retry|stats --help\n`);
    }
    process.exit(3);
    return;
  }
  // Errores del runtime: ya fueron logueados por los cmd-*. Aqui solo exit.
  process.exit(exitCodeFor(err));
}

// Auto-run solo cuando el archivo es el entrypoint del proceso (no cuando
// se importa desde un test, donde `process.argv[1]` apunta al test runner).
// Ver `specs/repo-hygiene §Commander Banner Suppressed In Test Runner`.
const isMainModule =
  typeof require !== 'undefined' && require.main === module;
if (isMainModule) {
  program.parseAsync(process.argv).catch((err) => {
    handleError(err);
  });
}