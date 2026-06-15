"use client";

import type { Conversation, ConversationMode } from "@docmee/contracts";
import { Button } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useSetConversationMode } from "../../lib/api/conversations";

/**
 * Bot-mode toggle: take control (human), hand back (bot), pause, resolve.
 * Routes through PUT /conversations/{id}/mode. The bot never interrupts a human —
 * setting "human" pauses the bot server-side (locked product rule).
 */
export function ModeToggle({ conversation }: { conversation: Conversation }) {
  const t = useTranslations("inbox");
  const setMode = useSetConversationMode(conversation.id!);
  const mode = conversation.mode;

  const change = (next: ConversationMode) => setMode.mutate(next);
  const busy = setMode.isPending;

  return (
    <div className="flex flex-wrap gap-2">
      {mode === "bot" ? (
        <Button size="sm" disabled={busy} onClick={() => change("human")}>
          {t("takeControl")}
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => change("bot")}>
          {t("handBack")}
        </Button>
      )}
      {mode !== "paused" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => change("paused")}>
          {t("pause")}
        </Button>
      ) : null}
      {mode !== "resolved" ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => change("resolved")}>
          {t("resolve")}
        </Button>
      ) : null}
    </div>
  );
}
