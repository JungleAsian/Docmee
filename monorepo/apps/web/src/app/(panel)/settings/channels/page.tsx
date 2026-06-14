"use client";

import type { ChannelConnection } from "../../../../lib/api/contract-types";
import { Badge, Button, Card, CardContent, Skeleton, type BadgeProps } from "@docmee/ui";
import { useTranslations } from "next-intl";
import { useChannels, useConnectChannel } from "../../../../lib/api/channels";
import { SettingsSubPage } from "../../../../components/app-shell/settings-subpage";

const LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
};

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  connected: "success",
  disconnected: "secondary",
  pending: "warning",
};

export default function ChannelsPage() {
  const t = useTranslations("channels");
  const { data: channels, isLoading } = useChannels();
  const connect = useConnectChannel();

  return (
    <SettingsSubPage title={t("title")}>
      {isLoading || !channels ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => (
            <li key={c.channel}>
              <ChannelCard
                connection={c}
                pending={connect.isPending && connect.variables === c.channel}
                onConnect={() => connect.mutate(c.channel!)}
              />
            </li>
          ))}
        </ul>
      )}
    </SettingsSubPage>
  );
}

function ChannelCard({
  connection,
  pending,
  onConnect,
}: {
  connection: ChannelConnection;
  pending: boolean;
  onConnect: () => void;
}) {
  const t = useTranslations("channels");
  const status = connection.status ?? "disconnected";
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <div>
          <p className="font-medium">{LABEL[connection.channel ?? ""] ?? connection.channel}</p>
          {connection.displayName ? (
            <p className="text-sm text-muted-foreground">{connection.displayName}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>
          {status !== "connected" ? (
            <Button size="sm" disabled={pending} onClick={onConnect}>
              {pending ? t("connecting") : t("connect")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
