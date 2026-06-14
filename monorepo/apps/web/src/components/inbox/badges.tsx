"use client";

import type { Channel, ConversationMode } from "@docmee/contracts";
import { Badge, type BadgeProps } from "@docmee/ui";
import { useTranslations } from "next-intl";

const MODE_VARIANT: Record<ConversationMode, BadgeProps["variant"]> = {
  bot: "outline",
  human: "default",
  paused: "warning",
  resolved: "success",
};

export function ModeBadge({ mode }: { mode: ConversationMode }) {
  const t = useTranslations("inbox.mode");
  return <Badge variant={MODE_VARIANT[mode]}>{t(mode)}</Badge>;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
};

export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {CHANNEL_LABEL[channel]}
    </Badge>
  );
}
