import type { ReactNode } from "react";
import { Sidebar } from "../../components/app-shell/sidebar";
import { Topbar } from "../../components/app-shell/topbar";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-muted/30">{children}</main>
      </div>
    </div>
  );
}
