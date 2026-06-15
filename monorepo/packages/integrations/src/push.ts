/**
 * Web Push (VAPID) sender (Phase 3D). Provider-abstracted so notification dispatch
 * never depends on a concrete transport and tests use a fake. The real adapter
 * uses the `web-push` library (optional dep) — wired, activated when VAPID keys
 * are provisioned.
 */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  readonly name: string;
  send(target: PushTarget, message: PushMessage): Promise<{ ok: boolean; gone?: boolean }>;
}

/** Records sends in-memory for tests/dev (no VAPID keys needed). */
export class FakePushSender implements PushSender {
  readonly name = "fake-push";
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];
  send(target: PushTarget, message: PushMessage): Promise<{ ok: boolean }> {
    this.sent.push({ target, message });
    return Promise.resolve({ ok: true });
  }
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string; // mailto: or https URL
}

/**
 * Real VAPID sender via the `web-push` package (dynamically imported so it isn't a
 * hard dependency until push is enabled). A 404/410 marks the subscription gone so
 * callers can prune it.
 */
export class VapidPushSender implements PushSender {
  readonly name = "vapid-push";
  constructor(private readonly cfg: VapidConfig) {}

  async send(
    target: PushTarget,
    message: PushMessage,
  ): Promise<{ ok: boolean; gone?: boolean }> {
    // Computed specifier keeps `web-push` an OPTIONAL runtime dep (not bundled,
    // not required to typecheck) — loaded only when push is actually enabled.
    const moduleName = "web-push";
    const mod = (await import(moduleName)) as {
      default?: unknown;
      setVapidDetails?: unknown;
    };
    const webpush = (mod.default ?? mod) as {
      setVapidDetails: (s: string, pub: string, priv: string) => void;
      sendNotification: (sub: unknown, payload: string) => Promise<unknown>;
    };
    webpush.setVapidDetails(this.cfg.subject, this.cfg.publicKey, this.cfg.privateKey);
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(message),
      );
      return { ok: true };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410 };
    }
  }
}
