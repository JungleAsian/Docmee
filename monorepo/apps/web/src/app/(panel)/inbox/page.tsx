"use client";

import { cn } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConversationList } from "../../../components/inbox/conversation-list";
import { ConversationThread } from "../../../components/inbox/conversation-thread";

export default function InboxPage() {
  const t = useTranslations("inbox");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div className="flex h-full">
      <div className={cn("h-full shrink-0", selectedId ? "hidden md:block" : "block w-full md:w-auto")}>
        <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className={cn("h-full flex-1", selectedId ? "flex" : "hidden md:flex")}>
        {selectedId ? (
          <ConversationThread conversationId={selectedId} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground">
            {t("selectConversation")}
          </div>
        )}
      </div>
    </div>
  );
}
