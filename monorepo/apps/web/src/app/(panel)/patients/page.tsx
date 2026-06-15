"use client";

import type { Patient } from "@docmee/contracts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
} from "@docmee/ui";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useCreatePatient, usePatients } from "../../../lib/api/patients";

export default function PatientsPage() {
  const t = useTranslations("patients");
  const tc = useTranslations("common");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data: patients, isLoading, isError, refetch } = usePatients(search);

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("new")}
          </Button>
        ) : null}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("search")}
          className="pl-9"
        />
      </div>

      {creating ? <PatientCreateForm onClose={() => setCreating(false)} /> : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-destructive">{tc("error")}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc("retry")}
          </Button>
        </div>
      ) : !patients || patients.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {patients.map((p) => (
            <li key={p.id}>
              <PatientRow patient={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PatientRow({ patient }: { patient: Patient }) {
  return (
    <Link href={`/patients/${patient.id}`}>
      <Card className="transition-colors hover:bg-muted">
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{patient.name}</p>
            <p className="truncate text-sm text-muted-foreground">{patient.phone}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            {(patient.tags ?? []).map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function PatientCreateForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("patients");
  const create = useCreatePatient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    const tagList = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      { name: name.trim(), phone: phone.trim(), tags: tagList },
      {
        onSuccess: () => {
          setName("");
          setPhone("");
          setTags("");
          onClose();
        },
      },
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">{t("name")}</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-phone">{t("phone")}</Label>
            <Input id="p-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-tags">{t("tags")}</Label>
            <Input
              id="p-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("tagsPlaceholder")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
              {create.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
