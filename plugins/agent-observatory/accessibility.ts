import type { ModelUsageBar } from "./observation";

export function modelUsageAccessibilityLabel(bar: ModelUsageBar): string {
  return `${bar.model}, ${bar.totalTokens} total tokens. Composition: ${bar.freshInputTokens} fresh input, ${bar.cachedInputTokens} cached input, ${bar.outputTokens} output. ${bar.costState === "unknown" ? "Cost unknown" : bar.costState === "partial" ? "Cost partial" : `Cost $${bar.reportedCostUsd?.toFixed(4) ?? "0.0000"}`}.`;
}
