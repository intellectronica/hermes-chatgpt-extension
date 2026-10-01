import type { App } from '@modelcontextprotocol/ext-apps';
import type { ActionArgs, ActionName } from '../shared/types';

export interface HermesApi {
  call<T>(action: ActionName, args?: ActionArgs, signal?: AbortSignal): Promise<T>;
}

export class ActionError extends Error {
  constructor(message: string, readonly code = 'action_failed') {
    super(message);
    this.name = 'ActionError';
  }
}

/** The transcript stays in UI metadata and is never sent to the outer model. */
export function resultData<T>(result: unknown): T {
  if (typeof result !== 'object' || result === null) {
    throw new ActionError('The bridge returned an invalid response.');
  }
  const value = result as Record<string, unknown>;
  const meta = value._meta as Record<string, unknown> | undefined;
  if (value.isError || value.error) {
    const error = (value.error ?? meta?.error) as { message?: unknown; code?: unknown } | undefined;
    const content = Array.isArray(value.content) ? value.content : [];
    const text = content.find((item: unknown) =>
      typeof item === 'object' && item !== null && (item as { type?: string }).type === 'text',
    ) as { text?: string } | undefined;
    throw new ActionError(
      typeof error?.message === 'string' ? error.message : text?.text ?? 'The bridge could not complete this action.',
      typeof error?.code === 'string' ? error.code : undefined,
    );
  }
  if (meta && 'data' in meta) return meta.data as T;
  if ('data' in value) return value.data as T;
  throw new ActionError('The bridge response did not contain UI data.');
}

export function createHostApi(app: App): HermesApi {
  return {
    async call<T>(action: ActionName, args = {}, signal?: AbortSignal) {
      const result = await app.callServerTool(
        { name: action, arguments: args },
        { signal, timeout: 35_000 },
      );
      return resultData<T>(result);
    },
  };
}

/** The loopback bridge sets an HttpOnly, SameSite cookie when opening this page. */
export function createHttpApi(fetcher: typeof fetch = fetch): HermesApi {
  return {
    async call<T>(action: ActionName, args = {}, signal?: AbortSignal) {
      const response = await fetcher('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
        signal,
      });
      if (!response.ok) {
        // The bridge bounds/redacts these structured errors before returning them.
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === 'object' && 'error' in body) return resultData<T>(body);
        throw new ActionError(
          response.status === 401
            ? 'This bridge session has expired. Reload the page to reconnect.'
            : `The bridge could not complete this action (HTTP ${response.status}).`,
          response.status === 401 ? 'unauthorised' : 'action_failed',
        );
      }
      return resultData<T>(await response.json());
    },
  };
}

export function friendlyError(error: unknown): string {
  return error instanceof ActionError ? error.message : 'The connection was lost. Reconnect to check the current state.';
}
