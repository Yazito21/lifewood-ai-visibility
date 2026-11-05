import { supabase } from "@/lib/supabase";
import { gatherSnapshot, type ReportPeriod } from "@/lib/report-data";

/** Gathers the AI visibility snapshot in the browser, then asks site-audit to build the report. Returns the report id. */
export async function startReport(projectId: string, period: ReportPeriod, onStage?: (stage: string) => void): Promise<string> {
  onStage?.("Gathering AI visibility data…");
  const snapshot = await gatherSnapshot(supabase, projectId, period);
  onStage?.("Starting the website audit…");
  const { data, error } = await supabase.functions.invoke("site-audit", {
    body: {
      action: "start",
      project_id: projectId,
      period_start: period.start,
      period_end: period.end,
      period_label: period.label,
      tracking_location: snapshot.location,
      snapshot,
    },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { message?: string; error?: string } | undefined;
    try { payload = await context?.json(); } catch { payload = undefined; }
    throw new Error(payload?.message ?? (context?.status === 403 ? "Only admins can generate reports." : "The report could not be started. Try again."));
  }
  const reportId = (data as { report_id?: string } | null)?.report_id;
  if (!reportId) throw new Error("The report could not be started. Try again.");
  return reportId;
}
