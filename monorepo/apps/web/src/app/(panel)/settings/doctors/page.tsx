"use client";

import { Button, Card, CardContent, Input, Label, Skeleton } from "@docmee/ui";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreateDoctor, useDoctors } from "../../../../lib/api/doctors";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

export default function DoctorsPage() {
  const t = useTranslations("doctors");
  const { data: doctors, isLoading } = useDoctors();
  const create = useCreateDoctor();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), specialty: specialty.trim() },
      {
        onSuccess: () => {
          setName("");
          setSpecialty("");
          setOpen(false);
        },
      },
    );
  }

  return (
    <SettingsSubPage title={t("title")}>
      {!open ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t("new")}
        </Button>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="d-name">{t("name")}</Label>
                <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="d-spec">{t("specialty")}</Label>
                <Input id="d-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" size="sm" disabled={create.isPending}>
                  {t("save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading || !doctors ? (
        <Skeleton className="h-24 w-full" />
      ) : doctors.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {doctors.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="flex items-center justify-between py-3">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-muted-foreground">{d.specialty}</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}
