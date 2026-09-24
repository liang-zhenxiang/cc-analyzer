import { AppShell } from "./app/AppShell";
import { installTauriBridges } from "./api/tauri";

export default function App() {
  return (
    <AppShell bridges={installTauriBridges()} />
  );
}
