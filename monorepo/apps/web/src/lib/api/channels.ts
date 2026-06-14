import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ChannelConnection, ChannelConnectionPage } from "./contract-types";

export function useChannels(): UseQueryResult<ChannelConnection[], Error> {
  return useQuery({
    queryKey: ["channels"],
    queryFn: async () => (await apiFetch<ChannelConnectionPage>("/channels")).data ?? [],
  });
}

export function useConnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channel: string) =>
      apiFetch<ChannelConnection>(`/channels/${channel}/connect`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels"] }),
  });
}
