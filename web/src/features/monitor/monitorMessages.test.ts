import { describe, expect, test } from "vitest";
import { isLocalMonitorOrigin } from "./monitorMessages";

describe("isLocalMonitorOrigin", () => {
  test("accepts the dashboard origin on the probed port", () => {
    expect(isLocalMonitorOrigin("http://localhost:8090", 8090)).toBe(true);
    expect(isLocalMonitorOrigin("http://127.0.0.1:8090", 8090)).toBe(true);
    expect(isLocalMonitorOrigin("http://[::1]:8090", 8090)).toBe(true);
  });

  test("accepts any loopback port while the port is still unknown", () => {
    expect(isLocalMonitorOrigin("http://localhost:4173", null)).toBe(true);
  });

  test("rejects non-loopback origins", () => {
    expect(isLocalMonitorOrigin("http://evil.example:8090", 8090)).toBe(false);
    expect(isLocalMonitorOrigin("https://dashboard.example", null)).toBe(false);
    expect(isLocalMonitorOrigin("http://localhost.evil.example:8090", 8090)).toBe(false);
  });

  test("rejects loopback origins on the wrong port or protocol", () => {
    expect(isLocalMonitorOrigin("http://localhost:9999", 8090)).toBe(false);
    expect(isLocalMonitorOrigin("https://localhost:8090", 8090)).toBe(false);
  });

  test("rejects opaque or malformed origins", () => {
    expect(isLocalMonitorOrigin("", 8090)).toBe(false);
    expect(isLocalMonitorOrigin("null", 8090)).toBe(false);
    expect(isLocalMonitorOrigin("tauri://localhost", null)).toBe(false);
  });
});
