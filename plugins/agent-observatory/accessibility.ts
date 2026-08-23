import type { AgentLifecycle, ModelUsageBar } from "./observation";

export type UsageChartPalette = { fresh: string; cached: string; output: string };

export function usageChartPalette(colors: { accent: string; accentForeground: string; statusDanger: string }): UsageChartPalette {
  return { fresh: colors.accent, cached: colors.accentForeground, output: colors.statusDanger };
}

export type ObservatoryLayout = "compact" | "medium" | "wide";

export type LifecycleStyle = "active" | "waiting" | "finished" | "failed" | "other";

export function lifecycleStyle(lifecycle: AgentLifecycle): LifecycleStyle {
  return lifecycle;
}

export function observatoryLayout(width: number, compact: boolean): ObservatoryLayout {
  if (compact || width < 600) return "compact";
  if (width < 960) return "medium";
  return "wide";
}

export function selectedAgentMetadata(input: { workspaceName: string; model: string | null; finalizedTokens: number; costState: "complete" | "partial" | "unknown"; switchedModels: boolean }): string {
  return `${input.workspaceName} · ${input.model ?? "Model unknown"} · ${input.finalizedTokens.toLocaleString()} finalized tokens · ${input.costState} cost${input.switchedModels ? " · switched model" : ""}`;
}

export function turnDisplayLabel(turn: { provisional: boolean }, index: number): string {
  return turn.provisional ? "live" : `turn ${index + 1}`;
}

export function turnAccessibilityLabel(turn: { provisional: boolean; model: string | null; inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null }): string {
  const input = turn.inputTokens ?? 0;
  const cached = Math.min(turn.cachedInputTokens ?? 0, input);
  const fresh = Math.max(0, input - cached);
  const output = turn.outputTokens ?? 0;
  return `${turn.provisional ? "Live" : "Finalized"} turn${turn.model ? `, model ${turn.model}` : ""}: ${input + output} total tokens. Composition: ${fresh} fresh input, ${cached} cached input, ${output} output.`;
}

export function modelUsageAccessibilityLabel(bar: ModelUsageBar): string {
  return `${bar.model}, ${bar.totalTokens} total tokens. Composition: ${bar.freshInputTokens} fresh input, ${bar.cachedInputTokens} cached input, ${bar.outputTokens} output. ${bar.costState === "unknown" ? "Cost unknown" : bar.costState === "partial" ? "Cost partial" : `Cost $${bar.reportedCostUsd?.toFixed(4) ?? "0.0000"}`}.`;
}
