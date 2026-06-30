import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Guard rail para `post-entrega-polish §S5`: asegura que el smoke
 * script canonico vive en `scripts/smoke.ts` y que `package.json`
 * lo invoca con `tsx scripts/smoke.ts`. Si este test falla, alguien
 * movio el smoke de vuelta a `src/main/smoke.ts`.
 */

describe('smoke-script-path (post-entrega-polish §S5)', () => {
  it('scripts/smoke.ts existe en el repo', () => {
    const path = join(process.cwd(), 'scripts', 'smoke.ts');
    expect(existsSync(path)).toBe(true);
  });

  it('package.json scripts.smoke matchea /tsx scripts\\/smoke\\.ts/', () => {
    const pkgRaw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    const smoke = pkg.scripts?.smoke ?? '';
    expect(smoke).toMatch(/^tsx scripts\/smoke\.ts$/);
  });
});