# scraper-challenge

Scraper TypeScript para el portal publico del OEFA
(`https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml`).

Replica la navegacion del portal **sin browser automation** (solo `axios` +
`cheerio`). Descarga PDFs de resoluciones del TFA y persiste los resultados
en disco. Maneja rate limit (HTTP 429) con backoff exponencial + jitter, y
reanuda corridas incompletas leyendo `data/json/documentos.json`.

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
| `npm test` | Ejecuta la suite de tests con Vitest (193 specs). |
| `npm run smoke` | Corre un smoke test contra el portal real de OEFA (1 pagina, 1 PDF, sector `PESQUERIA`). |
| `npm run scrape -- [opciones]` | Ejecuta el scraper completo (scrape + download + stats). |
| `npm run retry -- [opciones]` | Re-intenta solo las filas listadas en `data/json/fallidos.json`. |
| `npm run stats` | Imprime un resumen de la ultima corrida (`stats.json`). |

## Uso rapido (demo)

Descarga 1 pagina del sector Pesqueria y 20 PDFs (corrida de demo, ~30-60 s):

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
- descarga **todos los PDFs** disponibles (sin cap),
- escribe 1 archivo por fila en `data/pdfs/<expediente>/<resolucion>.pdf`,
- pesa **aproximadamente 10-20 GB** en disco.

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
├── tests/unit/                  # specs vitest (193 tests)
├── tests/fixtures/              # HTML del spike original (consulta, try-4-nonajax)
└── data/                        # OUTPUTS (gitignored)
    ├── json/
    │   ├── documentos.json      # filas extraidas + status
    │   ├── fallidos.json        # filas que fallaron la descarga
    │   └── stats.json           # resumen de la ultima corrida
    ├── pdfs/<expediente>/<resolucion>.pdf
    └── logs/<ISO8601>.log       # 1 archivo por corrida
```

## Output esperado

### `data/json/documentos.json`

Array de objetos `DocumentoPersistido`. Ejemplo:

```json
{
  "documento": {
    "nro": "1",
    "numeroExpediente": "891-08-PRODUCE/DIGSECOVI-Dsvs",
    "administrado": "Corporación del Mar S.A. Austral Group S.A.A.",
    "unidadFiscalizable": "Planta Playa Lado Norte Puerto Malabrigo",
    "sector": "Pesquería",
    "numeroResolucionApelacion": "264-2012-OEFA/TFA",
    "archivo": {
      "sourceId": "listarDetalleInfraccionRAAForm:dt:0:j_idt63",
      "paramUuid": "153a6d2a-cbed-40ef-b8ef-cd2272b19867"
    }
  },
  "status": "ok",
  "pdfPath": "data/pdfs/891-08-PRODUCE-DIGSECOVI-Dsvs/RTFA-N-264-2012-OEFA-TFA.pdf",
  "lastAttemptAt": "2026-06-29T23:31:59.043Z",
  "attempts": 5
}
```

### `npm run stats`

```
runId                 2026-06-29T23-31-55-888Z
startedAt             2026-06-29T23:31:55.888Z
finishedAt            2026-06-29T23:31:59.091Z
paginasProcesadas     1
totalPaginas          26
documentosOk          1
documentosFallidos    0
documentosPendientes  9
pdfsSaltados          0
pdfsDescargados       1
reintentosTotales     0
```

## Resume y retry

La corrida es **resumible**:
- Si un PDF ya esta en disco con magic bytes `%PDF-` valido, no se
  re-descarga (skip). El skip no cuenta contra `--max-pdfs`.
- Si un PDF esta corrupto o incompleto, se borra y se re-descarga.
- Si la corrida se interrumpe, basta con volver a ejecutar `npm run scrape`
  — retoma desde la primera pagina no persistida en `data/json/documentos.json`.

Para re-intentar SOLO las filas que quedaron en `fallidos.json`:

```bash
npm run retry -- --max-pdfs 50
```

Si el retry tiene exito, las filas se eliminan automaticamente de
`fallidos.json` y se actualiza su `status` en `documentos.json`.

## Exit codes

| Code | Cuando |
|------|--------|
| 0 | Corrida completa (con o sin fallidos). `stats` siempre retorna 0. |
| 2 | Bootstrap fatal (portal no responde 2xx). |
| 3 | Input invalido del CLI (e.g. sector desconocido). |
| 4 | `MalformedHtmlError` (portal devolvio splash XML en vez de grilla). |

## Troubleshoot

### HTTP 429 sostenido (rate limit del portal)

- Backoff exponencial con jitter ya aplicado (5 reintentos default).
- Si 429 no para, reducir ritmo: usar `--max-pdfs 50` para correr en lotes
  y dejar pasar minutos entre lotes.
- Re-ejecutar `npm run scrape` — los PDFs ya descargados se saltean.

### Magic bytes invalidos (`fallidos.json` con `reason: 'magic_bytes_invalidos'`)

- El portal respondio HTML/XML en lugar del PDF (suele pasar con un
  ViewState stale tras una corrida interrumpida).
- Solucion: borrar `data/pdfs/<expediente>/` de la fila fallida y correr
  `npm run retry -- --max-pdfs 50`.

### Portal caido / DNS fail

- Si el portal no responde, `npm run scrape` aborta con exit 2 (bootstrap
  fatal) o con varias filas en `fallidos.json` con `reason: 'red_desconocida'`.
- Re-ejecutar cuando el portal este disponible.

### Corrida se interrumpe

- Re-ejecutar `npm run scrape`. El sistema:
  - Lee `data/json/documentos.json`.
  - Reanuda la paginacion desde la primera pagina no persistida.
  - Re-descarga solo PDFs corruptos o faltantes.

### Disco lleno

- La corrida completa pesa ~10-20 GB. Si te quedaste sin disco, bajale a
  `--max-pdfs 100` y corre en lotes.

## Decisiones tecnicas

- **Sin browser automation**: solo `axios` + `cheerio`. El portal es
  JSF 2.x + PrimeFaces 6.0; su flujo completo es replicable con HTTP crudo.
- **Concurrencia forzada a 1** (`p-limit(1)`): el ViewState de JSF muta
  por cada request y rompe con concurrencia > 1.
- **Backoff full jitter** (formula AWS): cada reintento duerme un tiempo
  random entre `0` y `min(60s, base * 2^attempt)`.
- **Magic bytes check** antes de aceptar el PDF: corruptos se borran y
  re-descargan.
- **Writes atomicos via `*.tmp + fs.rename`**: un kill mid-write no deja
  JSON truncado.

## Estado del proyecto

- Tests: 193 specs vitest (todos verdes).
- Cobertura: parsers, storage, HTTP (mocked), retry, use cases, CLI.
- No browser-automation deps (`puppeteer`/`playwright`/`selenium-webdriver`/
  `jsdom`) — el guard de test falla si alguien las agrega.
- Smoke verificado contra el portal real de OEFA (sector `PESQUERIA`,
  1 pagina, 1 PDF, 9.4 MB con magic bytes `%PDF-1.4` validos).

Ver `openspec/changes/scraper-oefa/` para el diseno completo, las specs
y los registros de cada PR (1 a 5).