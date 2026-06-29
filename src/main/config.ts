import { Command, Option } from 'commander';
import { SECTORS_VALIDOS, SECTOR_MAP } from '../domain/sector-map';
import type { Sector } from '../domain/entities';

/**
 * Configuracion normalizada que la CLI pasa a `buildContainer`.
 * Ver `design.md §6.2` y `tasks.md §27`.
 */
export interface CliConfig {
  readonly sector: Sector;
  readonly maxPaginas?: number;
  readonly maxPdfs: number | 'unlimited';
  readonly retries: number;
  readonly concurrency: number;
  readonly dataDir: string;
  readonly delayBetweenRequestsMs: number;
}

/**
 * Parsea los argumentos de la linea de comando. La firma es generica
 * (no recibe `process.argv`) para que los tests puedan inyectar args
 * arbitrarios sin tocar el entorno real.
 *
 * Comportamiento:
 *   - `--sector` validado contra `SECTORS_VALIDOS`; si es invalido,
 *     imprime error + usage y lanza `InvalidCliInputError` (exit code 3).
 *   - `--concurrency > 1` -> warn + clamp a 1 (per spec).
 *   - `--max-pdfs 'unlimited'` o numero; default `unlimited`.
 *
 * El sub-comando (`scrape`, `retry`, `stats`) NO se parsea aqui:
 * `parseArgs` se enfoca en los flags. Commander se encarga del
 * routing en `cli.ts`.
 */
export function parseArgs(argv: string[]): CliConfig {
  const cmd = new Command();
  cmd
    .name('scraper-cli')
    .description('Scraper OEFA — flags compartidos por todos los sub-comandos.')
    .allowUnknownOption() // los sub-comandos añaden los suyos propios
    .exitOverride();      // evitamos que commander llame process.exit en tests

  cmd.addOption(
    new Option('--sector <SECTOR>', 'filtrar por sector')
      .choices(SECTORS_VALIDOS as unknown as string[])
      .default('TODOS'),
  );
  cmd.option('--pages <N>', 'limitar paginas a iterar', (v: string) => parsePositiveInt(v, '--pages'));
  cmd.option('--max-pdfs <N|unlimited>', 'cap de PDFs (default unlimited)', parseMaxPdfs, 'unlimited');
  cmd.option('--retries <N>', 'intentos por PDF (default 5)', (v: string) => parsePositiveInt(v, '--retries'), 5);
  cmd.option('--concurrency <N>', 'concurrencia (forzado a 1; spec)', (v: string) => parsePositiveInt(v, '--concurrency'), 1);
  cmd.option('--delay-ms <N>', 'delay entre requests en ms (default 500)', (v: string) => parsePositiveInt(v, '--delay-ms'), 500);
  cmd.option('--data-dir <PATH>', 'directorio de datos (default data)', 'data');

  // Parseamos solo los flags (sin posicionar).
  try {
    cmd.parse(argv, { from: 'user' });
  } catch (err) {
    // Commander lanza CommanderError para choices/required failures.
    // Lo re-lanzamos como InvalidCliInputError para que el caller
    // mapee a exit code 3 (per design §6.3).
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      if (
        code === 'commander.invalidArgument' ||
        code === 'commander.invalidOption' ||
        code === 'commander.unknownOption' ||
        code === 'commander.missingArgument'
      ) {
        const message = err instanceof Error ? err.message : String(err);
        throw new InvalidCliInputError(message);
      }
    }
    throw err;
  }

  const opts = cmd.opts<{
    sector: string;
    pages?: number;
    maxPdfs: number | 'unlimited';
    retries: number;
    concurrency: number;
    delayMs: number;
    dataDir: string;
  }>();

  // Validacion del sector.
  if (!(SECTORS_VALIDOS as readonly string[]).includes(opts.sector)) {
    throw new InvalidCliInputError(
      `--sector invalido: "${opts.sector}". Valores validos: ${SECTORS_VALIDOS.join(', ')}`,
    );
  }

  // Validacion indirecta: el sector debe estar en SECTOR_MAP.
  if (!(opts.sector in SECTOR_MAP)) {
    throw new InvalidCliInputError(`--sector "${opts.sector}" no esta en SECTOR_MAP`);
  }

  // concurrency > 1 -> warn + clamp (el caller loguea via logger).
  const concurrency = opts.concurrency > 1 ? 1 : opts.concurrency;

  return {
    sector: opts.sector as Sector,
    maxPaginas: opts.pages,
    maxPdfs: opts.maxPdfs,
    retries: opts.retries,
    concurrency,
    dataDir: opts.dataDir,
    delayBetweenRequestsMs: opts.delayMs,
  };
}

/**
 * Error tipado para input invalido de la CLI. El entrypoint lo mapea
 * a exit code 3 (per `design.md §6.3`).
 */
export class InvalidCliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCliInputError';
  }
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidCliInputError(`${flag} debe ser un entero >= 1, recibio "${value}"`);
  }
  return n;
}

function parseMaxPdfs(value: string): number | 'unlimited' {
  if (value === 'unlimited') return 'unlimited';
  return parsePositiveInt(value, '--max-pdfs');
}