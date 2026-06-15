"use client";

import type { AutomationSettings } from "../../../../lib/api/contract-types";
import { Button, Card, CardContent, Input, Label, Skeleton } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { useAutomationSettings, useUpdateAutomationSettings } from "../../../../lib/api/templates";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

export default function AutomationPage() {
  const t = useTranslations("automation");
  const { data, isLoading } = useAutomationSettings();
  const update = useUpdateAutomationSettings();
  const [form, setForm] = useState<AutomationSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    setSaved(false);
    update.mutate(form, { onSuccess: () => setSaved(true) });
  }

  if (isLoading || !form) {
    return (
      <SettingsSubPage title={t("title")}>
        <Skeleton className="h-48 w-full" />
      </SettingsSubPage>
    );
  }

  return (
    <SettingsSubPage title={t("title")}>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <Toggle
              label={t("reminders")}
              checked={Boolean(form.remindersEnabled)}
              onChange={(v) => setForm({ ...form, remindersEnabled: v })}
            />
            <div className="space-y-1.5">
              <Label htmlFor="rh">{t("reminderHours")}</Label>
              <Input
                id="rh"
                type="number"
                min={1}
                value={form.reminderHoursBefore ?? 24}
                onChange={(e) => setForm({ ...form, reminderHoursBefore: Number(e.target.value) })}
                className="w-32"
              />
            </div>
            <Toggle
              label={t("followUps")}
              checked={Boolean(form.followUpsEnabled)}
              onChange={(v) => setForm({ ...form, followUpsEnabled: v })}
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="qs">{t("quietStart")}</Label>
                <Input id="qs" type="time" value={form.quietHoursStart ?? "21:00"} onChange={(e) => setForm({ ...form, quietHoursStart: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qe">{t("quietEnd")}</Label>
                <Input id="qe" type="time" value={form.quietHoursEnd ?? "07:00"} onChange={(e) => setForm({ ...form, quietHoursEnd: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("sixGate")}</p>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={update.isPending}>
                {t("save")}
              </Button>
              {saved ? <span className="text-sm text-success">{t("saved")}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </SettingsSubPage>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[hsl(var(--primary))]"
      />
    </label>
  );
}
