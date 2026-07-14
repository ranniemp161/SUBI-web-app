"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { ExitToDashboardLink } from "@/components/editor/exit-to-dashboard-link";

export function StatusScreen({
  icon,
  title,
  message,
  tone,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  tone?: "error";
}) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${tone === "error" ? "bg-red-500/10 text-red-400" : "bg-blue-500/15 text-blue-300"
          }`}
      >
        {icon}
      </div>
      <div className="space-y-1.5">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="max-w-md text-sm text-foreground/50">{message}</p>
      </div>
      <ExitToDashboardLink className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-foreground/10 px-3 py-1.5 text-sm text-foreground/70 hover:bg-foreground/10">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </ExitToDashboardLink>
    </div>
  );
}
