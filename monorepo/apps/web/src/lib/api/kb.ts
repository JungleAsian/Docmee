import type { KbEntry, KbEntryCreate, KbEntryPage } from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const kbKey = ["kb", "entries"] as const;

export function useKbEntries(): UseQueryResult<KbEntry[], Error> {
  return useQuery({
    queryKey: kbKey,
    queryFn: async () => (await apiFetch<KbEntryPage>("/kb/entries")).data ?? [],
  });
}

export function useCreateKbEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KbEntryCreate) =>
      apiFetch<KbEntry>("/kb/entries", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kbKey });
    },
  });
}
