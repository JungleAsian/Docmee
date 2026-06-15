import type { Role, User } from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  Clinic,
  ClinicPage,
  QuickReply,
  QuickReplyCreate,
  QuickReplyPage,
  UserCreate,
  UserPage,
} from "./contract-types";

export function useClinics(): UseQueryResult<Clinic[], Error> {
  return useQuery({
    queryKey: ["clinics"],
    queryFn: async () => (await apiFetch<ClinicPage>("/clinics")).data ?? [],
  });
}

export function useUsers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => (await apiFetch<UserPage>("/users")).data ?? [],
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UserCreate) => apiFetch<User>("/users", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useSetUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      apiFetch<User>(`/users/${userId}/role`, { method: "PUT", body: { role } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useQuickReplies(): UseQueryResult<QuickReply[], Error> {
  return useQuery({
    queryKey: ["quick-replies"],
    queryFn: async () => (await apiFetch<QuickReplyPage>("/quick-replies")).data ?? [],
  });
}

export function useCreateQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuickReplyCreate) =>
      apiFetch<QuickReply>("/quick-replies", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["quick-replies"] }),
  });
}
