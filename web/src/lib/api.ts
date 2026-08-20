/**
 * Thin fetch wrapper for the management API.
 *
 * The admin session lives in an httpOnly cookie, so every call is
 * `credentials: 'include'` and there is no token for JS to leak.
 */

/** Fired whenever the API reports the session is no longer valid. */
export const UNAUTHORIZED_EVENT = 'leadgen:unauthorized';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(path, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    // A 401 on any management call means the session is gone — expired, or
    // signed out in another tab. Announce it so the app can return to the login
    // screen instead of leaving a dashboard up that can no longer load anything.
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    const payload = body as { error?: string; details?: unknown } | null;
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed (${response.status})`,
      payload?.details
    );
  }

  return body as T;
}

function qs(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    request<T>(`${path}${qs(params)}`),
  post: <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json }),
  patch: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PATCH', json }),
  del: <T>(path: string, params?: Record<string, unknown>) =>
    request<T>(`${path}${qs(params)}`, { method: 'DELETE' }),
};

/**
 * The Playground calls the *public* lead API the way an external source would —
 * with an X-Api-Key rather than the admin session — so what you see in the UI is
 * exactly what a integrating partner would get.
 */
export async function publicApi<T>(
  path: '/api/ping' | '/api/post',
  apiKey: string,
  body: unknown
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const payload = parsed as { error?: string; details?: unknown } | null;
    throw new ApiError(response.status, payload?.error ?? `Request failed`, payload?.details);
  }
  return parsed as T;
}
