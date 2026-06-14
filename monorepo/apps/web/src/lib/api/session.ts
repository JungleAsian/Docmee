import type { Session } from "@docmee/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const sessionKey = ["session"] as const;

/** Resolve the current user + clinic context from the bearer token. */
export function fetchSession(): Promise<Session> {
  return apiFetch<Session>("/auth/session");
}

export function useSession(): UseQueryResult<Session, Error> {
  return useQuery({
    queryKey: sessionKey,
    queryFn: fetchSession,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
