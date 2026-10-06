import { AppShell } from "./app/AppShell";
import { installTauriBridges } from "./api/tauri";
import { initFontScale } from "./features/settings/fontScale";

// index.html 的预绘制脚本负责第一帧不闪；这里把内存 store 同步到同一档，
// 避免控件在首屏短暂显示默认 100%。
initFontScale();

export default function App() {
  return (
    <AppShell bridges={installTauriBridges()} />
  );
}
