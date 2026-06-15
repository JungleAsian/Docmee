import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  DocumentCreate,
  DocumentEntry,
  DocumentPage,
  ExportJob,
  ExportJobCreate,
  ExportJobPage,
  PushSubscriptionAck,
  PushSubscriptionCreate,
} from "./contract-types";

export function useDocuments(): UseQueryResult<DocumentEntry[], Error> {
  return useQuery({
    queryKey: ["documents"],
    queryFn: async () => (await apiFetch<DocumentPage>("/documents")).data ?? [],
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentCreate) =>
      apiFetch<DocumentEntry>("/documents", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useExports(): UseQueryResult<ExportJob[], Error> {
  return useQuery({
    queryKey: ["exports"],
    queryFn: async () => (await apiFetch<ExportJobPage>("/exports")).data ?? [],
  });
}

export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExportJobCreate) =>
      apiFetch<ExportJob>("/exports", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["exports"] }),
  });
}

export function subscribePush(input: PushSubscriptionCreate): Promise<PushSubscriptionAck> {
  return apiFetch<PushSubscriptionAck>("/push/subscribe", { method: "POST", body: input });
}
