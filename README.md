# scraper-challenge

Scraper TypeScript para el portal publico del OEFA
(`https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`).

- Sin browser automation (solo `axios` + `cheerio`).
- Descarga PDFs del portal y persiste resultados en disco.
- Maneja rate limit (HTTP 429) con backoff exponencial + jitter.
- Reanuda corridas incompletas leyendo `data/json/documentos.json`.

## Requisitos

- Node.js >= 18
- npm

## Instalacion

```bash
npm install
```

## Scripts

| Script | Descripcion |
|--------|-------------|
| `npm run build` | Compila TypeScript a `dist/`. |
| `npm test` | Ejecuta la suite de tests con Vitest. |
| `npm run scrape -- [opciones]` | Ejecuta el scraper completo. |
| `npm run retry -- [opciones]` | Reintenta solo los registros en `data/json/fallidos.json`. |
| `npm run stats` | Muestra resumen de la ultima corrida. |

## Estado

Proyecto en construccion. Ver `openspec/changes/scraper-oefa/` para el diseno
completo y la lista de tareas.