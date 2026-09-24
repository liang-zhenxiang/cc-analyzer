const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Accepts window messages only from the local dashboard.
 *
 * The dashboard runs on `http://localhost:<monitor_port>`, so anything that is
 * not a plain http origin on loopback is rejected. `expectedPort` is the port
 * reported by the backend once the probe succeeded; while probing there is no
 * known port yet and any loopback origin is accepted.
 */
export function isLocalMonitorOrigin(origin: string, expectedPort: number | null): boolean {
  if (!origin) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:") return false;
  if (!LOCAL_HOSTS.has(url.hostname)) return false;
  if (expectedPort !== null && url.port !== String(expectedPort)) return false;
  return true;
}
