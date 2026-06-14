import type { Patient, PatientCreate, PatientPage } from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const patientsKey = (q = "") => ["patients", { q }] as const;

export function usePatients(q = ""): UseQueryResult<Patient[], Error> {
  return useQuery({
    queryKey: patientsKey(q),
    queryFn: async () => {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      return (await apiFetch<PatientPage>(`/patients${qs}`)).data ?? [];
    },
  });
}

export function usePatient(patientId: string | undefined): UseQueryResult<Patient, Error> {
  return useQuery({
    queryKey: ["patient", patientId],
    queryFn: () => apiFetch<Patient>(`/patients/${patientId}`),
    enabled: Boolean(patientId),
  });
}

export function useCreatePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PatientCreate) =>
      apiFetch<Patient>("/patients", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["patients"] });
    },
  });
}
