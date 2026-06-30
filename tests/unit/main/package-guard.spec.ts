import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard rail: el proyecto esta explicitamente prohibido de depender
 * de cualquier libreria de browser automation. Esto es por diseno
 * (ver `openspec/changes/scraper-oefa/proposal.md §Out of Scope` y
 * `openspec/changes/scraper-oefa/design.md §7.2`).
 *
 * Si este test falla, alguien agrego una dependencia prohibida.
 * Las razon para el veto:
 *  - Puppeteer/Playwright/Selenium/WebDriver descargan un Chromium
 *    entero (~150 MB) y rompen el scrape en CI minimal.
 *  - El portal OEFA es accesible con HTTP crudo (ver spike).
 *  - jsdom como motor de ejecucion introduce overhead y bugs que
 *    no necesitamos: solo queremos parsear HTML estatico.
 */
const FORBIDDEN_DEPS = [
  'puppeteer',
  'puppeteer-core',
  'playwright',
  'playwright-core',
  'selenium-webdriver',
  'webdriverio',
  'jsdom',
] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function loadPackageJson(): PackageJson {
  const pkgPath = join(process.cwd(), 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  return JSON.parse(raw) as PackageJson;
}

describe('package-guard', () => {
  it('package.json existe y es JSON valido', () => {
    const pkg = loadPackageJson();
    expect(pkg).toBeTruthy();
    expect(typeof pkg).toBe('object');
  });

  it.each(FORBIDDEN_DEPS)(
    'no contiene la dependencia prohibida "%s" en ningun bloque',
    (dep) => {
      const pkg = loadPackageJson();
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.optionalDependencies ?? {}),
      };
      expect(
        Object.keys(allDeps),
        `Dependencia prohibida detectada: ${dep}`,
      ).not.toContain(dep);
    },
  );

  it('declara al menos las dependencias runtime minimas', () => {
    const pkg = loadPackageJson();
    const deps = pkg.dependencies ?? {};
    // No exigimos versiones exactas: el guard solo verifica presencia.
    expect(deps).toHaveProperty('axios');
    expect(deps).toHaveProperty('cheerio');
  });

  it('smoke script no apunta a src/main/smoke (post-entrega-polish §S5)', () => {
    const pkg = loadPackageJson() as PackageJson & { scripts?: Record<string, string> };
    const smoke = pkg.scripts?.smoke ?? '';
    expect(smoke).not.toContain('src/main/smoke');
  });
});