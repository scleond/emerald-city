import { describe, expect, it } from "vitest";
import { lifecycleStyle, modelUsageAccessibilityLabel, observatoryLayout, turnAccessibilityLabel } from "./accessibility";
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
  expect([observatoryLayout(400, false), observatoryLayout(800, false), observatoryLayout(1200, false), observatoryLayout(1200, true)]).toEqual(["compact", "medium", "wide", "compact"]);
  expect(turnAccessibilityLabel({ provisional: true, model: "gpt-4", inputTokens: 12, cachedInputTokens: 8, outputTokens: 5 })).toBe("Live turn, model gpt-4: 17 total tokens. Composition: 4 fresh input, 8 cached input, 5 output.");
});
