import { describe, expect, it } from "vitest";
import { modelUsageAccessibilityLabel } from "./accessibility";

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
