import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CopilotSuggestion, Flow, FlowCreate, FlowPage } from "./contract-types";

export function useFlows(): UseQueryResult<Flow[], Error> {
  return useQuery({
    queryKey: ["flows"],
    queryFn: async () => (await apiFetch<FlowPage>("/flows")).data ?? [],
  });
}

export function useCreateFlow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FlowCreate) => apiFetch<Flow>("/flows", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["flows"] }),
  });
}

export function useCopilotSuggest() {
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiFetch<CopilotSuggestion>("/copilot/suggest", {
        method: "POST",
        body: { conversationId },
      }),
  });
}
