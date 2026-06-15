import type { Message, MessagePage } from "@docmee/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AnalyticsOverview } from "./contract-types";

export function useAnalyticsOverview(): UseQueryResult<AnalyticsOverview, Error> {
  return useQuery({
    queryKey: ["analytics-overview"],
    queryFn: () => apiFetch<AnalyticsOverview>("/analytics/overview"),
  });
}

export function useMessageSearch(q: string): UseQueryResult<Message[], Error> {
  return useQuery({
    queryKey: ["message-search", q],
    queryFn: async () =>
      (await apiFetch<MessagePage>(`/messages/search?q=${encodeURIComponent(q)}`)).data ?? [],
    enabled: q.trim().length > 1,
  });
}
