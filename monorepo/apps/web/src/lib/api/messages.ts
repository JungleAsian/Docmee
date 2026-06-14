import type { Message, MessageCreate, MessagePage } from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const messagesKey = (conversationId: string) =>
  ["conversations", conversationId, "messages"] as const;

export function useMessages(
  conversationId: string | undefined,
): UseQueryResult<Message[], Error> {
  return useQuery({
    queryKey: messagesKey(conversationId ?? ""),
    queryFn: async () =>
      (await apiFetch<MessagePage>(`/conversations/${conversationId}/messages`)).data ?? [],
    enabled: Boolean(conversationId),
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MessageCreate) =>
      apiFetch<Message>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: messagesKey(conversationId) });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
