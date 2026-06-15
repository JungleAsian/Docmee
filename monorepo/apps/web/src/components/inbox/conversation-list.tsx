"use client";

import type { Conversation, ConversationMode } from "@docmee/contracts";
import { CONVERSATION_MODES } from "@docmee/contracts";
import { Button, cn, Skeleton } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useConversations, type ConversationFilters } from "../../lib/api/conversations";
import { usePatients } from "../../lib/api/patients";
import { ChannelBadge, ModeBadge } from "./badges";

interface Props {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function ConversationList({ selectedId, onSelect }: Props) {
  const t = useTranslations("inbox");
  const [mode, setMode] = useState<ConversationMode | undefined>(undefined);
  const filters: ConversationFilters = mode ? { mode } : {};
  const { data: conversations, isLoading } = useConversations(filters);
  const { data: patients } = usePatients();

  const nameOf = (patientId: string | undefined) =>
    patients?.find((p) => p.id === patientId)?.name ?? patientId ?? "—";

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-card md:w-80">
      <div className="flex h-14 items-center px-4">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
      </div>
      <div className="flex flex-wrap gap-1 border-y border-border px-3 py-2">
        <FilterChip active={mode === undefined} onClick={() => setMode(undefined)}>
          {t("filterAll")}
        </FilterChip>
        {CONVERSATION_MODES.map((m) => (
          <FilterChip key={m} active={mode === m} onClick={() => setMode(m)}>
            {t(`mode.${m}`)}
          </FilterChip>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id}>
                <ConversationRow
                  conversation={c}
                  name={nameOf(c.patientId)}
                  selected={c.id === selectedId}
                  onClick={() => onSelect(c.id!)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  name,
  selected,
  onClick,
}: {
  conversation: Conversation;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted",
        selected && "bg-primary/10",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{name}</span>
        {conversation.mode ? <ModeBadge mode={conversation.mode} /> : null}
      </div>
      {conversation.channel ? <ChannelBadge channel={conversation.channel} /> : null}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" className="h-7 px-2.5" onClick={onClick}>
      {children}
    </Button>
  );
}
