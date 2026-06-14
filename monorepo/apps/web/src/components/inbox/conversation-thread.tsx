"use client";

import type { Message } from "@docmee/contracts";
import { cn, Skeleton } from "@docmee/ui";
import { useLocale, useTranslations } from "next-intl";
import { useConversations } from "../../lib/api/conversations";
import { useMessages } from "../../lib/api/messages";
import { usePatient } from "../../lib/api/patients";
import { ChannelBadge, ModeBadge } from "./badges";
import { MessageComposer } from "./message-composer";
import { ModeToggle } from "./mode-toggle";

export function ConversationThread({ conversationId }: { conversationId: string }) {
  const t = useTranslations("inbox");
  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === conversationId);
  const { data: patient } = usePatient(conversation?.patientId);
  const { data: messages, isLoading } = useMessages(conversationId);

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Skeleton className="h-6 w-40" />
      </div>
    );
  }

  const windowOpen = conversation.windowExpiresAt
    ? new Date(conversation.windowExpiresAt).getTime() > Date.now()
    : false;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-col gap-2 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{patient?.name ?? conversation.patientId}</span>
            {conversation.channel ? <ChannelBadge channel={conversation.channel} /> : null}
            {conversation.mode ? <ModeBadge mode={conversation.mode} /> : null}
          </div>
          <span className={cn("text-xs", windowOpen ? "text-success" : "text-muted-foreground")}>
            {windowOpen ? t("windowOpen") : t("windowClosed")}
          </span>
        </div>
        <ModeToggle conversation={conversation} />
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
        {isLoading ? (
          <>
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-2/3" />
          </>
        ) : (
          messages?.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <MessageComposer conversationId={conversationId} />
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const locale = useLocale();
  const outbound = message.direction === "outbound";
  const time = message.createdAt
    ? new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(message.createdAt))
    : "";

  return (
    <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2 text-sm",
          outbound
            ? message.author === "bot"
              ? "bg-accent text-accent-foreground"
              : "bg-primary text-primary-foreground"
            : "bg-card text-card-foreground border border-border",
        )}
      >
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
      <span className="mt-0.5 px-1 text-[11px] text-muted-foreground">
        {message.author} · {time}
      </span>
    </div>
  );
}
