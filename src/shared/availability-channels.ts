// Sandboxed preload imports constants only; keep validation dependencies in main/renderer.
export const availabilityAnalysisChannels = {
  read: "calendar:availability-analysis",
  open: "calendar:availability-open",
  context: "calendar:availability-context",
} as const;
