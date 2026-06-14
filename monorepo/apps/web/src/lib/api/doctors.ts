import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Doctor, DoctorCreate, DoctorPage } from "./contract-types";

export function useDoctors(): UseQueryResult<Doctor[], Error> {
  return useQuery({
    queryKey: ["doctors"],
    queryFn: async () => (await apiFetch<DoctorPage>("/doctors")).data ?? [],
  });
}

export function useCreateDoctor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DoctorCreate) =>
      apiFetch<Doctor>("/doctors", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["doctors"] }),
  });
}
