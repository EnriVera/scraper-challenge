import { describe, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { OefaHttpClient } from '../../../../src/infrastructure/http/oefa-http-client';
import { RateLimitedError, TransientHttpError } from '../../../../src/domain/errors';
import { ConsoleLogger } from '../../../../src/infrastructure/logging/console-logger';

// ViewState >= 1000 chars para satisfacer spec §Bootstrap Session.
const LONG_VIEW_STATE = 'a'.repeat(1452);
const ROTATED_VIEW_STATE = 'b'.repeat(1664);

const BOOTSTRAP_HTML = `<html><body>
  <form id="listarDetalleInfraccionRAAForm">
    <input type="hidden" name="javax.faces.ViewState" value="${LONG_VIEW_STATE}">
    <tbody id="listarDetalleInfraccionRAAForm:dt_data" class="ui-datatable-empty-message"></tbody>
    <span class="ui-paginator-pages"></span>
  </form>
</body></html>`;

const BUSCAR_HTML = `<html><body>
  <form id="listarDetalleInfraccionRAAForm">
    <input type="hidden" name="javax.faces.ViewState" value="${ROTATED_VIEW_STATE}">
    <tr data-ri="0"><td>1</td><td>891-08-PRODUCE/DIGSECOVI-Dsvs</td></tr>
    <tr data-ri="9"><td>10</td></tr>
    <span class="ui-paginator-current">Página 1 de 176 (1753 registros)</span>
  </form>
</body></html>`;

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // %PDF-1.4\n

describe('OefaHttpClient', () => {
  let mock: MockAdapter;
  let client: OefaHttpClient;

  beforeEach(() => {
    const instance = axios.create({ baseURL: 'https://publico.oefa.gob.pe' });
    mock = new MockAdapter(instance);
    client = new OefaHttpClient({
      axios: instance,
      log: new ConsoleLogger({ stderr: true }),
      baseURL: 'https://publico.oefa.gob.pe',
    });
  });

  describe('bootstrap', () => {
    it('captura ViewState >= 1000 chars (spec §Bootstrap Session With Initial GET)', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(200, BOOTSTRAP_HTML, {
        'Content-Type': 'text/html',
        'Set-Cookie': 'JSESSIONID=abc123; Path=/; HttpOnly; Secure',
      });

      const { viewState } = await client.bootstrap();
      expect(viewState.length).toBeGreaterThanOrEqual(1000);
      expect(viewState).toBe(LONG_VIEW_STATE);
      expect(client.getCurrentViewState()).toBe(LONG_VIEW_STATE);
    });

    it('almacena la cookie JSESSIONID en el jar', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(200, BOOTSTRAP_HTML, {
        'Set-Cookie': 'JSESSIONID=test-session; Path=/; HttpOnly; Secure',
      });

      await client.bootstrap();

      const cookies = await client.getCookieJar().getCookies(
        'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml',
      );
      const jsession = cookies.find((c) => c.key === 'JSESSIONID');
      expect(jsession).toBeDefined();
      expect(jsession?.value).toBe('test-session');
    });

    it('lanza error en respuesta non-2xx (spec §Bootstrap fails on non-2xx)', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(503, 'Service Unavailable');
      await expect(client.bootstrap()).rejects.toThrow(/503/);
    });

    it('lanza error si el body no trae ViewState >= 1000 chars', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(
        200,
        '<html><body>no viewstate here</body></html>',
        { 'Content-Type': 'text/html' },
      );
      await expect(client.bootstrap()).rejects.toThrow(/ViewState/);
    });

    it('lanza error si GET falla por red', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').networkError();
      await expect(client.bootstrap()).rejects.toThrow();
    });
  });

  describe('postBuscar', () => {
    it('manda los 9 campos del form + ViewState (spec §POST with all form fields serialised)', async () => {
      let capturedBody = '';
      mock
        .onGet('/repdig/consulta/consultaTfa.xhtml')
        .reply(200, BOOTSTRAP_HTML, { 'Set-Cookie': 'JSESSIONID=x' });
      mock
        .onPost('/repdig/consulta/consultaTfa.xhtml')
        .reply((config) => {
          capturedBody = String(config.data);
          return [200, BUSCAR_HTML, { 'Content-Type': 'text/html' }];
        });

      await client.bootstrap();
      const res = await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });

      expect(res.status).toBe(200);
      // 9 campos canonicos + ViewState
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm=listarDetalleInfraccionRAAForm');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3AtxtNroexp=');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Aj_idt21=');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Aj_idt25=');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Aj_idt34=');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Aidsector=');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Adt_scrollState=0%2C0');
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3AbtnBuscar=btnBuscar');
      expect(capturedBody).toContain(`javax.faces.ViewState=${LONG_VIEW_STATE}`);
    });

    it('sector=PESQUERIA -> idsector=8 en el body', async () => {
      let capturedBody = '';
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply((config) => {
        capturedBody = String(config.data);
        return [200, BUSCAR_HTML, { 'Content-Type': 'text/html' }];
      });

      await client.postBuscar(LONG_VIEW_STATE, { idsector: '8' });
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Aidsector=8');
    });

    it('actualiza currentViewState desde la respuesta (spec §ViewState Rotation Per Response)', async () => {
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply(200, BUSCAR_HTML, {
        'Content-Type': 'text/html',
      });

      await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
      expect(client.getCurrentViewState()).toBe(ROTATED_VIEW_STATE);
    });

    it('Content-Type del POST es application/x-www-form-urlencoded; charset=UTF-8', async () => {
      let contentType = '';
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply((config) => {
        contentType = String(config.headers?.['Content-Type'] ?? '');
        return [200, BUSCAR_HTML, { 'Content-Type': 'text/html' }];
      });

      await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
      expect(contentType).toContain('application/x-www-form-urlencoded');
      expect(contentType).toContain('charset=UTF-8');
    });

    it('NO manda headers AJAX (Faces-Request / X-Requested-With)', async () => {
      let sentFacesRequest: string | undefined;
      let sentXRequested: string | undefined;
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply((config) => {
        sentFacesRequest = config.headers?.['Faces-Request'] as string | undefined;
        sentXRequested = config.headers?.['X-Requested-With'] as string | undefined;
        return [200, BUSCAR_HTML, { 'Content-Type': 'text/html' }];
      });

      await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
      expect(sentFacesRequest).toBeUndefined();
      expect(sentXRequested).toBeUndefined();
    });
  });

  describe('postPagina', () => {
    it('manda dt_paginator=n-1 (spec §Jump to page N)', async () => {
      let capturedBody = '';
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply((config) => {
        capturedBody = String(config.data);
        return [200, BUSCAR_HTML, { 'Content-Type': 'text/html' }];
      });

      await client.postPagina(LONG_VIEW_STATE, 2);
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Adt_paginator=1');

      await client.postPagina(LONG_VIEW_STATE, 5);
      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm%3Adt_paginator=4');
    });

    it('rechaza pageNumber < 2', async () => {
      await expect(client.postPagina(LONG_VIEW_STATE, 1)).rejects.toThrow(/>= 2/);
      await expect(client.postPagina(LONG_VIEW_STATE, 0)).rejects.toThrow(/>= 2/);
    });
  });

  describe('postDescargarPdf', () => {
    it('replica mojarra.jsfcljs: sourceId + param_uuid + ViewState (spec §PDF Download Replicating mojarra.jsfcljs)', async () => {
      let capturedBody = '';
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply((config) => {
        capturedBody = String(config.data);
        return [
          200,
          PDF_BYTES,
          {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment;filename="RTFA N° 264-2012.pdf"',
          },
        ];
      });

      const res = await client.postDescargarPdf(
        LONG_VIEW_STATE,
        'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
        '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
      );

      expect(capturedBody).toContain('listarDetalleInfraccionRAAForm=listarDetalleInfraccionRAAForm');
      expect(capturedBody).toContain(
        'listarDetalleInfraccionRAAForm%3Adt%3A0%3Aj_idt63=listarDetalleInfraccionRAAForm%3Adt%3A0%3Aj_idt63',
      );
      expect(capturedBody).toContain('param_uuid=153a6d2a-cbed-40ef-b8ef-cd2272b19867');
      expect(capturedBody).toContain(`javax.faces.ViewState=${LONG_VIEW_STATE}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/octet-stream');
    });

    it('devuelve body como Uint8Array empezando con %PDF (0x25 0x50 0x44 0x46)', async () => {
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply(200, PDF_BYTES, {
        'Content-Type': 'application/octet-stream',
      });

      const res = await client.postDescargarPdf(
        LONG_VIEW_STATE,
        'listarDetalleInfraccionRAAForm:dt:0:j_idt63',
        '153a6d2a-cbed-40ef-b8ef-cd2272b19867',
      );

      expect(res.bodyBytes).toBeInstanceOf(Uint8Array);
      expect(res.bodyBytes[0]).toBe(0x25);
      expect(res.bodyBytes[1]).toBe(0x50);
      expect(res.bodyBytes[2]).toBe(0x44);
      expect(res.bodyBytes[3]).toBe(0x46);
    });

    it('rechaza sourceId o paramUuid vacios', async () => {
      await expect(
        client.postDescargarPdf(LONG_VIEW_STATE, '', 'uuid'),
      ).rejects.toThrow(/sourceId/);
      await expect(
        client.postDescargarPdf(LONG_VIEW_STATE, 'sid', ''),
      ).rejects.toThrow(/paramUuid/);
    });
  });

  describe('mapeo de errores', () => {
    it('429 -> RateLimitedError con retryAfterMs del header Retry-After', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(200, BOOTSTRAP_HTML);
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply(429, 'rate limited', {
        'Retry-After': '30',
      });

      await client.bootstrap();
      try {
        await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitedError);
        expect((err as RateLimitedError).retryAfterMs).toBe(30_000);
      }
    });

    it('429 sin Retry-After -> RateLimitedError con retryAfterMs=null', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(200, BOOTSTRAP_HTML);
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply(429, 'rate limited');

      await client.bootstrap();
      try {
        await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitedError);
        expect((err as RateLimitedError).retryAfterMs).toBeNull();
      }
    });

    it('502/503/504 -> TransientHttpError con httpStatus correcto', async () => {
      mock.onGet('/repdig/consulta/consultaTfa.xhtml').reply(200, BOOTSTRAP_HTML);
      mock.onPost('/repdig/consulta/consultaTfa.xhtml').reply(502, 'bad gateway');

      await client.bootstrap();
      try {
        await client.postBuscar(LONG_VIEW_STATE, { idsector: '' });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TransientHttpError);
        expect((err as TransientHttpError).httpStatus).toBe(502);
      }
    });
  });
});