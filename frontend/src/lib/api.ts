/**
 * ============================================================================
 *  API client — BRD §13.1
 * ============================================================================
 *  · Bearer access token in memory + rotating refresh token in an HttpOnly cookie
 *  · transparent refresh on 401 (single-flight, so parallel 401s do not stampede)
 *  · the standard error envelope is unwrapped into an ApiError
 *  · decimals arrive as strings and are never coerced to floats for scoring
 * ============================================================================
 */
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';
import { demoAdapter } from './demo/adapter';

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    field_errors: ApiFieldError[];
    correlation_id: string | null;
    path?: string;
    timestamp?: string;
  };
}

export class ApiError extends Error {
  code: string;
  status: number;
  fieldErrors: ApiFieldError[];
  correlationId: string | null;

  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    const e = body?.error;
    super(e?.message || fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = e?.code ?? 'INTERNAL-ERROR';
    this.fieldErrors = e?.field_errors ?? [];
    this.correlationId = e?.correlation_id ?? null;
  }

  /** The message for a specific form field, if the API flagged one. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((f) => f.field === field)?.message;
  }

  get isOutOfScope(): boolean {
    return this.code === 'OUT-OF-SCOPE' || this.status === 403;
  }

  get isStale(): boolean {
    return this.code === 'STALE-VERSION';
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Demo mode.
 *
 * A static deployment (Vercel, Netlify, GitHub Pages) cannot host the NestJS API
 * with PostgreSQL, Redis and BullMQ. Unless demo mode is explicitly disabled, the
 * client probes the API once; if it is unreachable the in-browser demo adapter
 * takes over, so every screen — including sign-in — works with no visible errors.
 *
 * Set `VITE_DEMO_MODE=false` to force the real API only.
 */
type DemoMode = 'unknown' | 'live' | 'demo';

const DEMO_SETTING = String(import.meta.env.VITE_DEMO_MODE ?? 'auto').toLowerCase();
let demoMode: DemoMode = DEMO_SETTING === 'true' ? 'demo' : DEMO_SETTING === 'false' ? 'live' : 'unknown';

export const isDemoMode = (): boolean => demoMode === 'demo';
export const demoModeState = (): DemoMode => demoMode;
export const setDemoMode = (mode: DemoMode): void => {
  demoMode = mode;
};

/** Probe the API once and cache the outcome. */
export const detectApiMode = async (): Promise<DemoMode> => {
  if (demoMode !== 'unknown') return demoMode;
  if (DEMO_SETTING === 'true') return demoMode;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_500);
    const response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    const body = (await response.json().catch(() => null)) as { data?: { checks?: { database?: string } } } | null;
    const healthy = response.ok && body?.data?.checks?.database === 'up';
    demoMode = healthy ? 'live' : 'demo';
  } catch {
    demoMode = 'demo';
  }
  return demoMode;
};


/** In-memory access token — never persisted to localStorage (NFR-SEC-05). */
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export const getAccessToken = (): string | null => accessToken;

export const setSessionExpiredHandler = (handler: () => void): void => {
  onSessionExpired = handler;
};

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 45_000,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // In demo mode every request is served from the in-browser dataset.
  if (demoMode === 'demo') {
    config.adapter = demoAdapter;
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  __isRetry?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Single-flight refresh.
 *
 * React StrictMode double-invokes effects in development, and two tabs can open
 * at once, so the bootstrap refresh MUST be shared: without this, the second
 * call would present a refresh token that the first call already rotated.
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ data: { accessToken: string } }>(
        `${API_BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 20_000 },
      )
      .then((response) => {
        const token: string | undefined = (response.data as unknown as { data?: { accessToken?: string } }).data?.accessToken;
        if (token) {
          accessToken = token;
          return token;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        // Allow the next 401 to trigger a fresh attempt
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      });
  }
  return refreshPromise;
};

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const status = error.response?.status ?? 0;
    const config = error.config as RetryableConfig | undefined;

    const isAuthRoute = (config?.url ?? '').includes('/auth/');

    if (status === 401 && config && !config.__isRetry && !isAuthRoute) {
      const token = await refreshAccessToken();
      if (token) {
        config.__isRetry = true;
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        return http.request(config);
      }
      accessToken = null;
      onSessionExpired?.();
    }

    return Promise.reject(
      new ApiError(status, error.response?.data, error.message || 'The request could not be completed.'),
    );
  },
);

/** The API wraps successful responses in `{ data, meta }`. */
const unwrap = <T>(payload: unknown): T => {
  if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>) && 'meta' in (payload as Record<string, unknown>)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
};

export interface RequestOptions extends AxiosRequestConfig {
  /** Optimistic locking (§13.1) — sent as If-Match. */
  ifMatch?: number | string;
  /** Idempotency for state-changing KPI calls (§13.1). */
  idempotencyKey?: string;
}

export const api = {
  async get<T>(url: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<T> {
    const response = await http.get(url, { params, ...options });
    return unwrap<T>(response.data);
  },
  async post<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {};
    if (options?.ifMatch !== undefined) headers['If-Match'] = String(options.ifMatch);
    if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const response = await http.post(url, body ?? {}, { ...options, headers: { ...headers, ...(options?.headers ?? {}) } });
    return unwrap<T>(response.data);
  },

  async patch<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {};
    if (options?.ifMatch !== undefined) headers['If-Match'] = String(options.ifMatch);
    const response = await http.patch(url, body ?? {}, { ...options, headers: { ...headers, ...(options?.headers ?? {}) } });
    return unwrap<T>(response.data);
  },

  async put<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await http.put(url, body ?? {}, options);
    return unwrap<T>(response.data);
  },

  async delete<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const response = await http.delete(url, { data: body, ...options });
    return unwrap<T>(response.data);
  },

  /** Multipart upload with progress (evidence, FR-EVD-01). */
  async upload<T>(
    url: string,
    formData: FormData,
    onProgress?: (percent: number) => void,
  ): Promise<T> {
    const response = await http.post(url, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });
    return unwrap<T>(response.data);
  },

  /** Raw download used by the CSV fallback and the signed evidence route. */
  async download(url: string, params?: Record<string, unknown>): Promise<Blob> {
    const response = await http.get(url, { params, responseType: 'blob' });
    return response.data as Blob;
  },
};

export const apiBaseUrl = API_BASE_URL;

/** Builds a query string from a filter object, dropping empty values. */
export const toQuery = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' ) return;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((v) => search.append(key, String(v)));
      return;
    }
    search.append(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

/** Saves a blob to disk with a filename (used by exports). */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
