/**
 * Update channel selection: `stable` is the default and `beta` is an explicit
 * opt-in — beta builds are what the AI maintainer ships every round, stable is
 * what the human maintainer has personally promoted. The endpoint mapping here
 * must stay in lockstep with `channel_endpoint` in `src-tauri/src/updater.rs`
 * (the Rust side owns the real check; this map exists for tests and UI copy).
 */

export type UpdateChannel = "stable" | "beta";

const CHANNEL_KEY = "cca-update-channel";
const AUTOCHECK_KEY = "cca-update-autocheck";

const ENDPOINTS: Record<UpdateChannel, string> = {
  stable: "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/stable/latest-stable.json",
  beta: "https://github.com/liang-zhenxiang/cc-analyzer/releases/download/beta/latest-beta.json"
};

/** Untrusted persisted values fall back to stable — never to beta. */
export function parseChannel(raw: unknown): UpdateChannel {
  return raw === "beta" ? "beta" : "stable";
}

export function loadChannel(storage: Pick<Storage, "getItem"> = localStorage): UpdateChannel {
  try {
    return parseChannel(storage.getItem(CHANNEL_KEY));
  } catch {
    return "stable";
  }
}

export function storeChannel(channel: UpdateChannel): void {
  try {
    localStorage.setItem(CHANNEL_KEY, channel);
  } catch {
    // Persistence is optional; the in-memory choice still applies this session.
  }
}

/** Auto-check on launch defaults ON: one plain GET, no upload (SECURITY.md). */
export function loadAutoCheck(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(AUTOCHECK_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeAutoCheck(enabled: boolean): void {
  try {
    localStorage.setItem(AUTOCHECK_KEY, enabled ? "on" : "off");
  } catch {
    // See storeChannel.
  }
}

export function channelEndpointOf(channel: UpdateChannel): string {
  return ENDPOINTS[channel];
}

export const CHANNEL_LABELS: Record<UpdateChannel, string> = {
  stable: "稳定版（推荐）",
  beta: "Beta（每轮功能自动发布，接受先行体验）"
};
