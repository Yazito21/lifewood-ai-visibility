"use client";

import { useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { downloadWorkbook } from "@/lib/excel-report";

type Built = { buffer: Uint8Array; filename: string };

/** Builds an Excel report on demand (the heavy libraries load only when clicked) and downloads it. */
export function DownloadReportButton({ build, disabled = false, label = "Download Excel" }: { build: () => Promise<Built>; disabled?: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError("");
    try {
      const { buffer, filename } = await build();
      downloadWorkbook(buffer, filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the Excel report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={() => void run()} disabled={disabled || busy} className="platform-btn disabled:opacity-50">
        {busy ? <RefreshCw size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
        {busy ? "Preparing Excel…" : label}
      </button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
