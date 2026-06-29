import { describe, it, expect } from 'vitest';
import { parseArgs, InvalidCliInputError } from '../../../src/main/config';

describe('parseArgs', () => {
  it('default sector es TODOS', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape']);
    expect(cfg.sector).toBe('TODOS');
    expect(cfg.maxPdfs).toBe('unlimited');
    expect(cfg.retries).toBe(5);
    expect(cfg.concurrency).toBe(1);
  });

  it('sector PESQUERIA se acepta', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--sector', 'PESQUERIA']);
    expect(cfg.sector).toBe('PESQUERIA');
  });

  it('sector invalido lanza InvalidCliInputError', () => {
    expect(() =>
      parseArgs(['node', 'cli', 'scrape', '--sector', 'AGRICULTURA']),
    ).toThrow(InvalidCliInputError);
  });

  it('--concurrency 4 se clampea a 1', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--concurrency', '4']);
    expect(cfg.concurrency).toBe(1);
  });

  it('--max-pdfs unlimited se acepta', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--max-pdfs', 'unlimited']);
    expect(cfg.maxPdfs).toBe('unlimited');
  });

  it('--max-pdfs 20 se acepta como numero', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--max-pdfs', '20']);
    expect(cfg.maxPdfs).toBe(20);
  });

  it('--pages 2 -> maxPaginas=2', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--pages', '2']);
    expect(cfg.maxPaginas).toBe(2);
  });

  it('--pages -1 -> InvalidCliInputError', () => {
    expect(() => parseArgs(['node', 'cli', 'scrape', '--pages', '-1'])).toThrow(
      InvalidCliInputError,
    );
  });

  it('--retries 2 -> retries=2', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--retries', '2']);
    expect(cfg.retries).toBe(2);
  });

  it('--data-dir custom', () => {
    const cfg = parseArgs(['node', 'cli', 'scrape', '--data-dir', '/tmp/foo']);
    expect(cfg.dataDir).toBe('/tmp/foo');
  });

  it('todos los sectores validos se aceptan', () => {
    const sectors = ['TODOS', 'MINERIA', 'ELECTRICIDAD', 'HIDROCARBUROS', 'INDUSTRIA', 'PESQUERIA'];
    for (const s of sectors) {
      const cfg = parseArgs(['node', 'cli', 'scrape', '--sector', s]);
      expect(cfg.sector).toBe(s);
    }
  });
});