import type { ApiError } from "@docmee/contracts";
import { API_BASE_URL as BASE_URL } from "../../config/env";
import { getToken } from "../auth";

/** Thrown for any non-2xx response; carries the contract's Error envelope. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, envelope: ApiError) {
    super(envelope.error.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = envelope.error.code;
    this.details = envelope.error.details as Record<string, unknown> | undefined;
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/**
 * Typed fetch against the Docmee API. The caller supplies the expected response
 * type, which always derives from `@docmee/contracts` — FE never hand-writes shapes.
 * Never send a clinic_id: every endpoint is clinic-scoped server-side (RLS).
 */
export async function apiFetch<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { body, headers, ...rest } = options;
  const token = getToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) {
    return undefined as TResponse;
  }

  const payload = (await res.json().catch(() => undefined)) as unknown;

  if (!res.ok) {
    const envelope = (payload as ApiError | undefined) ?? {
      error: { code: "unknown", message: res.statusText },
    };
    throw new ApiRequestError(res.status, envelope);
  }

  return payload as TResponse;
}
