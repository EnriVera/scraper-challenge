# scraper-challenge

Scraper TypeScript para el portal publico del OEFA
(`https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`).

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
| `npm run scrape -- [opciones]` | Ejecuta el scraper completo (scrape + download + stats). Los PDF se encutran en `data/pdfs` |
| `npm run retry -- [opciones]` | Re-intenta solo las filas listadas en `data/json/fallidos.json`. |
| `npm run stats` | Imprime un resumen de la ultima corrida (`stats.json`). |

## Uso rapido (demo)

Descarga 1 pagina del sector Pesqueria y 20 PDFs:

```bash
npm run scrape -- --sector PESQUERIA --pages 1 --max-pdfs 20
```

Ver resumen al final:

```bash
npm run stats
```

## Uso completo (corrida larga)

```bash
npm run scrape
```

Sin flags adicionales, la corrida:

- itera **las 176 paginas** de la grilla (1753 registros, sector TODOS),
- descarga **todos los PDFs**,
- escribe 1 archivo por fila en `data/pdfs/<expediente>/<resolucion>.pdf`,

Por eso el default es `--max-pdfs unlimited`. Si queres acotar:

```bash
npm run scrape -- --max-pdfs 100
```

Si queres un sector especifico:

```bash
npm run scrape -- --sector MINERIA
```

Sectores validos: `TODOS`, `MINERIA`, `ELECTRICIDAD`, `HIDROCARBUROS`,
`INDUSTRIA`, `PESQUERIA`.

## Flags del CLI

| Flag | Tipo | Default | Descripcion |
|------|------|---------|-------------|
| `--sector <S>` | enum | `TODOS` | Filtra por sector (ver valores arriba). |
| `--pages <N>` | int | unlimited | Procesa solo las primeras N paginas. |
| `--max-pdfs <N>` | int | `unlimited` | Cap de intentos de descarga. Skips no cuentan. |
| `--retries <N>` | int | `5` | Reintentos por PDF ante 429 / 5xx. |
| `--concurrency <N>` | int | `1` | Forzado a 1 (la sesion JSF no soporta concurrencia). |
| `--delay-ms <N>` | int | `0` | Delay opcional entre requests (no usado actualmente). |
| `--data-dir <path>` | path | `data` | Directorio donde se persiste el resultado. |

## Estructura del proyecto

```
scraper-challenge/
├── src/
│   ├── domain/                  # entidades, errores, puertos (zero Node deps)
│   ├── application/             # casos de uso (scrape, download, retry, full)
│   ├── infrastructure/          # adapters: http, parsers, storage, retry
│   ├── composition/             # wiring / DI (buildContainer)
│   └── main/                    # CLI + smoke + emit-stats + exit codes
└── data/                        # OUTPUTS (gitignored)
    ├── json/
    │   ├── documentos.json      # filas extraidas + status
    │   ├── fallidos.json        # filas que fallaron la descarga
    │   └── stats.json           # resumen de la ultima corrida
    ├── pdfs/<expediente>/<resolucion>.pdf
    └── logs/<ISO8601>.log       # 1 archivo por corrida
```

## Re Intentar
Para re-intentar SOLO las filas que quedaron en `fallidos.json`:

```bash
npm run retry -- --max-pdfs 50
```

Si el retry tiene exito, las filas se eliminan automaticamente de
`fallidos.json` y se actualiza su `status` en `documentos.json`.
