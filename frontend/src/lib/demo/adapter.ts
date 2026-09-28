/**
 * ============================================================================
 *  Demo HTTP adapter
 * ============================================================================
 *  When no API is reachable (a static single-page deployment such as Vercel),
 *  this axios adapter answers every request from the in-browser demo dataset.
 *
 *  It is transparent: the app code, the response envelope and the error model are
 *  unchanged, so sign-in, dashboards, KPI creation, approvals and reports all work
 *  with no backend and no visible errors.
 * ============================================================================
 */
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { resolveDemoRequest } from './resolver';

const API_PREFIX = '/api/v1';

/** Strips the origin and the API prefix so the resolver sees a clean path. */
const normalisePath = (rawUrl: string | undefined, baseURL: string | undefined): string => {
  let url = rawUrl ?? '';
  url = url.replace(/^https?:\/\/[^/]+/i, '');
  if (baseURL && url.startsWith(baseURL)) url = url.slice(baseURL.length);
  url = url.replace(/^\/?api\/v\d+/i, '');
  return url.replace(/^\/+/, '').split('?')[0].replace(/\/$/, '');
};

const parseBody = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  const method = (config.method ?? 'get').toUpperCase();
  const path = normalisePath(config.url, config.baseURL);
  const params = (config.params ?? {}) as Record<string, unknown>;

  // Merge query-string parameters that axios appends to the URL.
  const queryIndex = (config.url ?? '').indexOf('?');
  if (queryIndex >= 0) {
    new URLSearchParams((config.url ?? '').slice(queryIndex + 1)).forEach((value, key) => {
      params[key] = value;
    });
  }

  const result = resolveDemoRequest({
    method,
    url: path,
    params,
    body: parseBody(config.data),
    token: typeof config.headers?.Authorization === 'string' ? config.headers.Authorization : null,
  });

  if (!result) {
    throw new AxiosError('No demo route for ' + method + ' ' + path, 'ERR_BAD_REQUEST', config);
  }

  const headers = new AxiosHeaders({ 'content-type': 'application/json', 'x-demo-mode': 'true' });

  if (result.status >= 400) {
    const errorBody = { error: { code: 'DEMO-NOT-FOUND', message: 'This record is not part of the demo dataset.', field_errors: [], correlation_id: 'demo', path, timestamp: new Date().toISOString() } };
    throw new AxiosError(
      'Request failed with status code ' + result.status,
      String(result.status),
      config,
      null,
      { data: errorBody, status: result.status, statusText: 'Error', headers, config } as AxiosResponse,
    );
  }

  // Mirror the real API envelope so nothing downstream needs to change.
  return {
    data: { data: result.data, meta: { correlation_id: `demo-${Date.now()}`, timestamp: new Date().toISOString() } },
    status: result.status,
    statusText: 'OK',
    headers,
    config,
  } as AxiosResponse;
};
