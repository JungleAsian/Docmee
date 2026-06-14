import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  AutomationSettings,
  Template,
  TemplateCreate,
  TemplatePage,
} from "./contract-types";

export function useTemplates(): UseQueryResult<Template[], Error> {
  return useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await apiFetch<TemplatePage>("/templates")).data ?? [],
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateCreate) =>
      apiFetch<Template>("/templates", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useSubmitTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      apiFetch<Template>(`/templates/${templateId}/submit`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useAutomationSettings(): UseQueryResult<AutomationSettings, Error> {
  return useQuery({
    queryKey: ["automation-settings"],
    queryFn: () => apiFetch<AutomationSettings>("/automation/settings"),
  });
}

export function useUpdateAutomationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AutomationSettings) =>
      apiFetch<AutomationSettings>("/automation/settings", { method: "PUT", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["automation-settings"] }),
  });
}
