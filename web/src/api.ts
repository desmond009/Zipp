// Typed wrappers around the backend API. The types mirror the server's
// responses; they're duplicated rather than shared to keep the two builds
// independent (a shared package would be the next step if they drift).

export interface User {
  id: string;
  email: string;
}

export interface CreatedLink {
  code: string;
  shortUrl: string;
  longUrl: string;
  expiresAt: string | null;
  manageToken: string;
}

export interface Link {
  code: string;
  shortUrl: string;
  longUrl: string;
  createdAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired';
  clickCount: number;
}

export type LinkSort = 'newest' | 'clicks' | 'az';

export interface MyLinksPage {
  links: Link[];
  page: number;
  pageSize: number;
  total: number;
  linkCount: number;
  totalClicks: number;
}

export interface Breakdown {
  key: string;
  count: number;
}

export interface LinkStats {
  link: Link;
  from: string;
  to: string;
  totalClicks: number;
  previousTotalClicks: number;
  uniqueVisitors: number;
  daily: { date: string; clicks: number }[];
  breakdowns: Record<'countries' | 'devices' | 'browsers' | 'os' | 'referrers', Breakdown[]>;
}

export interface LiveClick {
  ts: string;
  country: string;
  device: string;
  browser: string;
  os: string;
  referrer: string;
}

/** An error response from the API: { error: { code, message } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    // Same origin in dev (Vite proxy) and prod, so the session cookie is sent automatically.
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? response.statusText);
  }
  return data as T;
}

export const api = {
  shorten: (input: { url: string; alias?: string; expiresAt?: string }) =>
    request<CreatedLink>('POST', '/api/shorten', input),

  me: () => request<{ user: User }>('GET', '/api/auth/me').then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/login', { email, password }).then((r) => r.user),
  register: (email: string, password: string) =>
    request<{ user: User }>('POST', '/api/auth/register', { email, password }).then((r) => r.user),
  logout: () => request<void>('POST', '/api/auth/logout'),

  myLinks: (params: { sort: LinkSort; q: string; page: number }) => {
    const query = new URLSearchParams({ sort: params.sort, page: String(params.page) });
    if (params.q) query.set('q', params.q);
    return request<MyLinksPage>('GET', `/api/me/links?${query}`);
  },
  deleteLink: (code: string) => request<void>('DELETE', `/api/links/${encodeURIComponent(code)}`),

  stats: (code: string, days: number) =>
    request<LinkStats>('GET', `/api/links/${encodeURIComponent(code)}/stats?days=${days}`),
  liveUrl: (code: string) => `/api/links/${encodeURIComponent(code)}/live`,
};
