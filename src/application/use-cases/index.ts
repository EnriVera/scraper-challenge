export { ScrapeTablaUseCase, type ScrapeTablaOpts, type ScrapeTablaResult } from './scrape-tabla';
export {
  DescargarPdfsUseCase,
  PDF_MAGIC,
  makeDocWithPdf,
  makePdfBytes,
  makeCorruptPdfBytes,
  type DescargarOpts,
  type DescargarResult,
} from './descargar-pdfs';
export {
  ReintentarFallidosUseCase,
  type ReintentarFallidosOpts,
} from './reintentar-fallidos';
export {
  EjecucionCompletaUseCase,
  JsonStatsRecorder,
  buildRunId,
  type FullRunConfig,
  type IStatsRecorder,
} from './ejecucion-completa';