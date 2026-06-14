import type {
  Appointment,
  AppointmentCreate,
  AppointmentPage,
  AppointmentStatus,
} from "@docmee/contracts";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface AppointmentFilters {
  patientId?: string;
  status?: AppointmentStatus;
}

export const appointmentsKey = (filters: AppointmentFilters = {}) =>
  ["appointments", filters] as const;

export function useAppointments(
  filters: AppointmentFilters = {},
): UseQueryResult<Appointment[], Error> {
  return useQuery({
    queryKey: appointmentsKey(filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.patientId) params.set("patientId", filters.patientId);
      if (filters.status) params.set("status", filters.status);
      const qs = params.toString();
      return (await apiFetch<AppointmentPage>(`/appointments${qs ? `?${qs}` : ""}`)).data ?? [];
    },
  });
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AppointmentCreate) =>
      apiFetch<Appointment>("/appointments", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
}
