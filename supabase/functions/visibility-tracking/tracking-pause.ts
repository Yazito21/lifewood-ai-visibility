export function isTrackingPaused(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}
