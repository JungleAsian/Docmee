import type { Conversation, ConversationMode, ConversationPage } from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface ConversationFilters {
  mode?: ConversationMode;
  channel?: string;
}

export const conversationsKey = (filters: ConversationFilters = {}) =>
  ["conversations", filters] as const;

export function useConversations(
  filters: ConversationFilters = {},
): UseQueryResult<Conversation[], Error> {
  return useQuery({
    queryKey: conversationsKey(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.mode) params.set("mode", filters.mode);
      if (filters.channel) params.set("channel", filters.channel);
      const qs = params.toString();
      const res = await apiFetch<ConversationPage>(`/conversations${qs ? `?${qs}` : ""}`);
      return res.data ?? [];
    },
  });
}

export function useSetConversationMode(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: ConversationMode) =>
      apiFetch<Conversation>(`/conversations/${conversationId}/mode`, {
        method: "PUT",
        body: { mode },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
