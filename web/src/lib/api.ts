import type { ApiErrorBody, ApiErrorCode, ImageRef } from '@manelly/shared';

/** `NETWORK` means the Manelly server itself could not be reached. */
export type ClientErrorCode = ApiErrorCode | 'NETWORK';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal });
}

export function sendJson<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
  return request<T>(path, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init.headers } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError('NETWORK', 'Der Manelly-Server antwortet nicht.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      apiError?.code ?? 'UPSTREAM_ERROR',
      apiError?.message ?? `Unerwartete Antwort vom Manelly-Server (HTTP ${response.status}).`,
      response.status,
    );
  }
  return body as T;
}

export function itemImageUrl(image: ImageRef, size: { maxWidth?: number; maxHeight?: number }): string {
  const params = new URLSearchParams({ tag: image.tag, quality: '90' });
  if (size.maxWidth) params.set('maxWidth', String(size.maxWidth));
  if (size.maxHeight) params.set('maxHeight', String(size.maxHeight));
  return `/api/images/items/${image.itemId}/${image.type}?${params}`;
}

export function userImageUrl(userId: string, tag: string, size: number): string {
  const params = new URLSearchParams({ tag, maxHeight: String(size), quality: '90' });
  return `/api/images/users/${userId}?${params}`;
}
