"use client";

import { Button, Textarea } from "@docmee/ui";
import { ApiRequestError } from "../../lib/api/client";
import { Sparkles, SendHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useCopilotSuggest } from "../../lib/api/flows";
import { useSendMessage } from "../../lib/api/messages";

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const t = useTranslations("inbox");
  const tCopilot = useTranslations("copilot");
  const send = useSendMessage(conversationId);
  const copilot = useCopilotSuggest();
  const [body, setBody] = useState("");
  const [blocked, setBlocked] = useState(false);

  function suggest() {
    copilot.mutate(conversationId, {
      onSuccess: (res) => {
        if (res.draft) setBody(res.draft);
      },
    });
  }

  function submit() {
    const text = body.trim();
    if (!text) return;
    setBlocked(false);
    send.mutate(
      { body: text },
      {
        onSuccess: () => setBody(""),
        onError: (err) => {
          // 409 = a gate (opt-out / window / etc.) blocked the send.
          if (err instanceof ApiRequestError && err.status === 409) setBlocked(true);
        },
      },
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-border bg-card p-3">
      {blocked ? <p className="mb-2 text-sm text-destructive">{t("blocked")}</p> : null}
      <div className="mb-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-muted-foreground"
          disabled={copilot.isPending}
          onClick={suggest}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {copilot.isPending ? tCopilot("suggesting") : tCopilot("suggest")}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("composerPlaceholder")}
          rows={2}
          className="min-h-[44px] resize-none"
        />
        <Button type="submit" size="icon" disabled={send.isPending || !body.trim()}>
          <SendHorizontal className="h-4 w-4" aria-hidden />
          <span className="sr-only">{t("send")}</span>
        </Button>
      </div>
    </form>
  );
}
