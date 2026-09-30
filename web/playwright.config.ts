import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试跑在**生产构建产物**上（`vite build` + `vite preview`），
 * 不是 dev server。差别很实际：dev 与 build 走的是两条不同的代码路径
 * （tree-shaking、chunk 切分、生产版 React），而用户拿到的是后者。
 *
 * Tauri 桥接由 `e2e/tauri-mock.ts` 通过 `addInitScript` 注入
 * `window.__TAURI_INTERNALS__` 打桩——那是 `@tauri-apps/api` 真正调用的边界，
 * 所以应用代码一行都不用改，测试也不会把桩代码带进发布包。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "e2e-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }
    },
    {
      // macOS 上 Tauri 用的是 WKWebView，而真机截图需要使用者手动授予
      // 「屏幕录制」权限（详见 .trellis/spec/testing/gui-tests.md）。
      // 跑一遍 WebKit 是在无权限前提下能做到的**最高保真近似**：
      // 同一引擎家族的渲染结果，且能进 CI。
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } }
    }
  ],

  webServer: {
    command: "npm run build && npm run preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe"
  }
});
