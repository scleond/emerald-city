import { describe, expect, it } from "vitest";
import { lifecycleStyle, modelUsageAccessibilityLabel, observatoryLayout, selectedAgentMetadata, turnAccessibilityLabel, turnDisplayLabel, usageChartPalette } from "./accessibility";
import type { AgentLifecycle } from "./observation";

it("projects every lifecycle to its own semantic style", () => {
  const lifecycles: AgentLifecycle[] = ["active", "waiting", "finished", "failed", "other"];
  expect(lifecycles.map(lifecycleStyle)).toEqual(lifecycles);
});

describe("model usage accessibility", () => {
  it("describes every chart segment and cost state", () => {
    expect(modelUsageAccessibilityLabel({
      model: "gpt-4",
      provider: "OpenAI",
      freshInputTokens: 12,
      cachedInputTokens: 8,
      outputTokens: 5,
      totalTokens: 25,
      reportedCostUsd: null,
      costState: "unknown",
    })).toBe("gpt-4, 25 total tokens. Composition: 12 fresh input, 8 cached input, 5 output. Cost unknown.");
  });
});

it("classifies widths deterministically and describes turn composition", () => {
  expect([observatoryLayout(599, false), observatoryLayout(600, false), observatoryLayout(959, false), observatoryLayout(960, false), observatoryLayout(1200, true)]).toEqual(["compact", "medium", "medium", "wide", "compact"]);
  expect(turnAccessibilityLabel({ provisional: true, model: "gpt-4", inputTokens: 12, cachedInputTokens: 8, outputTokens: 5 })).toBe("Live turn, model gpt-4: 17 total tokens. Composition: 4 fresh input, 8 cached input, 5 output.");
});

it("keeps selected-agent metadata compact and turn labels readable", () => {
  expect(selectedAgentMetadata({ workspaceName: "Main", model: "gpt-4", finalizedTokens: 1234, costState: "partial", switchedModels: true })).toBe("Main · gpt-4 · 1,234 finalized tokens · partial cost · switched model");
  expect(turnDisplayLabel({ provisional: false }, 2)).toBe("turn 3");
  expect(turnDisplayLabel({ provisional: true }, 2)).toBe("live");
});

it("uses distinct theme-derived semantic colors for every usage segment", () => {
  const palette = usageChartPalette({ accent: "#18a0fb", accentForeground: "#b56cff", statusDanger: "#ff6b6b" });
  expect(palette).toEqual({ fresh: "#18a0fb", cached: "#b56cff", output: "#ff6b6b" });
  expect(new Set(Object.values(palette)).size).toBe(3);
});
