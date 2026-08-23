import { describe, expect, it } from "vitest";
import { createUsageTurnStore, projectHistoricalUsage, type UsageTurnFileStorage, type NormalizedUsageTurn } from "./usage-turns";
import { historySourceLabel, prepareSanitizedUsageExport, projectHistoryForRange, sanitizedUsageExport } from "./usage-history";
import { normalizeUsageEvent } from "./observation";
import { emptyAgentUsage, fallbackUsageIdentity, reduceAgentUsage } from "./observation";

function storage(initial: string | null = null): UsageTurnFileStorage & { value: string | null } {
  return { value: initial, async read() { return this.value; }, async write(data) { this.value = data; } };
}
function turn(overrides: Partial<NormalizedUsageTurn> = {}): NormalizedUsageTurn {
  return { projectId: "p", workspaceId: "w", agentId: "a", turnId: "t", observedAt: "2026-01-10T00:00:00.000Z", startedAt: null, completedAt: "2026-01-10T00:00:00.000Z", model: "model", inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, contextUsedTokens: null, contextMaxTokens: null, costUsd: 0.1, costState: "complete", confidence: "high", ...overrides };
}

describe("usage turn store", () => {
  it("deduplicates anonymous final events without using observedAt as identity", () => {
    const event = { kind: "final" as const, model: "model", usage: { inputTokens: 10, outputTokens: 2 }, observedAt: "2026-01-01T00:00:00.000Z" };
    const once = reduceAgentUsage(emptyAgentUsage(), event);
    const twice = reduceAgentUsage(once, { ...event, observedAt: "2026-01-01T00:01:00.000Z" });
    expect(twice.finalizedTurns).toHaveLength(1);
  });

  it("keeps distinct same-model anonymous finals with different usage", () => {
    let record = reduceAgentUsage(emptyAgentUsage(), { kind: "final", model: "model", usage: { inputTokens: 10, outputTokens: 2 } });
    record = reduceAgentUsage(record, { kind: "final", model: "model", usage: { inputTokens: 10, outputTokens: 3 } });
    expect(record.finalizedTurns).toHaveLength(2);
  });

  it("keeps identical anonymous provisional turns queued when separately observed", () => {
    let record = reduceAgentUsage(emptyAgentUsage(), { kind: "provisional", model: "model", usage: { inputTokens: 10 }, observedAt: "2026-01-01T00:00:00.000Z" });
    record = reduceAgentUsage(record, { kind: "provisional", model: "model", usage: { inputTokens: 10 }, observedAt: "2026-01-01T00:01:00.000Z" });
    expect(record.provisionalTurns).toHaveLength(2);
  });

  it("does not consume a mismatched anonymous provisional", () => {
    const provisional = reduceAgentUsage(emptyAgentUsage(), { kind: "provisional", model: "model", usage: { inputTokens: 10 } });
    const result = reduceAgentUsage(provisional, { kind: "final", model: "model", usage: { inputTokens: 20 } });
    expect(result.provisionalTurns).toHaveLength(1);
    expect(result.finalizedTurns).toHaveLength(1);
  });


  it("replaces an anonymous provisional turn with its final event", () => {
    const provisional = reduceAgentUsage(emptyAgentUsage(), { kind: "provisional", model: "model", usage: { inputTokens: 10 } });
    const final = reduceAgentUsage(provisional, { kind: "final", model: "model", usage: { inputTokens: 10 } });
    expect(final.provisionalTurn).toBeNull();
    expect(final.finalizedTurns).toHaveLength(1);
  });

  it("clears an anonymous provisional when the final event has an identity", () => {
    const provisional = reduceAgentUsage(emptyAgentUsage(), { kind: "provisional", turnId: "generated-turn", model: "model", usage: { inputTokens: 10 } });
    const final = reduceAgentUsage(provisional, { kind: "final", turnId: "generated-turn", model: "model", usage: { inputTokens: 10, outputTokens: 2 } });
    expect(final.provisionalTurn).toBeNull();
    expect(final.finalizedTurns).toEqual([expect.objectContaining({ turnId: "generated-turn" })]);
  });
  it("normalizes live and historical usage shapes to one turn event", () => {
    expect(normalizeUsageEvent({ type: "usage_updated", turnId: "t", usage: { inputTokens: 1 }, timestamp: "2026-01-01T00:00:00.000Z" })).toMatchObject({ kind: "provisional", turnId: "t" });
    expect(normalizeUsageEvent({ kind: "turn_completed", turnId: "t", usage: { outputTokens: 2 }, observedAt: "2026-01-01T00:00:01.000Z" })).toMatchObject({ kind: "final", turnId: "t", observedAt: "2026-01-01T00:00:01.000Z" });
  });

  it("rejects null and empty usage at normalization", () => {
    expect(normalizeUsageEvent({ type: "turn_completed", usage: null })).toBeNull();
    expect(normalizeUsageEvent({ type: "usage_updated", usage: {} })).toBeNull();
  });

  it("exposes one stable anonymous persistence identity", () => {
    expect(fallbackUsageIdentity("model", { inputTokens: 1 })).toBe(fallbackUsageIdentity("model", { inputTokens: 1 }));
    expect(fallbackUsageIdentity("model", { inputTokens: 1 })).not.toBe(fallbackUsageIdentity("model", { inputTokens: 2 }));
  });
  it("exports only normalized usage fields", () => {
    const turn = { projectId: "p", workspaceId: "w", agentId: "a", turnId: "t", observedAt: "2026-01-01T00:00:00.000Z", startedAt: null, completedAt: null, model: "model", inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, contextUsedTokens: null, contextMaxTokens: null, costUsd: null, costState: "unknown", confidence: "high" } satisfies NormalizedUsageTurn;
    expect(sanitizedUsageExport([{ ...turn, prompt: "secret", payload: { password: "secret" } } as NormalizedUsageTurn])).toBe(JSON.stringify({ version: 1, turns: [turn] }));
  });

  it("prepares retrievable export data for the UI handoff", () => {
    const result = prepareSanitizedUsageExport([turn()]);
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.data!).turns[0]).not.toHaveProperty("payload");
  });

  it("labels history as local and reports the newest data age", () => {
    const turn = { projectId: "p", workspaceId: "w", agentId: "a", turnId: "t", observedAt: "2026-01-01T00:00:00.000Z", startedAt: null, completedAt: null, model: "model", inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, contextUsedTokens: null, contextMaxTokens: null, costUsd: null, costState: "unknown", confidence: "high" } satisfies NormalizedUsageTurn;
    expect(historySourceLabel(projectHistoricalUsage([turn], "24h", Date.parse("2026-01-01T12:00:00.000Z")))).toBe("Locally observed · last record 12h ago (2026-01-01T00:00:00.000Z)");
  });

  it.each([
    ["minute", "2026-01-01T11:59:00.000Z", "1m ago"],
    ["hour", "2026-01-01T11:00:00.000Z", "1h ago"],
    ["day", "2025-12-31T12:00:00.000Z", "1d ago"],
  ])("uses the projected timestamp precedence at the %s boundary", (_boundary, completedAt, age) => {
    const item = turn({
      observedAt: "2025-12-01T00:00:00.000Z",
      startedAt: "2025-12-15T00:00:00.000Z",
      completedAt,
    });
    expect(historySourceLabel(projectHistoricalUsage([item], "30d", Date.parse("2026-01-01T12:00:00.000Z")))).toContain(`last record ${age} (${completedAt})`);
  });

  it("falls back from completedAt to startedAt and then observedAt", () => {
    const base = Date.parse("2026-01-01T12:00:00.000Z");
    expect(historySourceLabel(projectHistoricalUsage([turn({ completedAt: null, startedAt: "2026-01-01T11:00:00.000Z" })], "24h", base))).toContain("1h ago (2026-01-01T11:00:00.000Z)");
    expect(historySourceLabel(projectHistoricalUsage([turn({ observedAt: "2026-01-01T00:00:00.000Z", completedAt: null, startedAt: null })], "24h", base))).toContain("12h ago (2026-01-01T00:00:00.000Z)");
  });

  it("wires the selected range into the historical projection", () => {
    const recent = turn({ turnId: "recent", observedAt: "2026-02-01T00:00:00.000Z", completedAt: "2026-02-01T00:00:00.000Z" });
    const old = turn({ turnId: "old", observedAt: "2026-01-01T00:00:00.000Z" });
    expect(projectHistoryForRange([recent, old], "24h", Date.parse("2026-02-10T00:00:00.000Z")).turns.map(({ turnId }) => turnId)).toEqual([]);
    expect(projectHistoryForRange([recent, old], "30d", Date.parse("2026-02-10T00:00:00.000Z")).turns.map(({ turnId }) => turnId)).toEqual(["recent"]);
  });

  it("projects fixed inclusive ranges in deterministic order and keeps history separate", () => {
    const now = Date.parse("2026-02-10T00:00:00.000Z");
    const result = projectHistoricalUsage([
      turn({ turnId: "boundary", completedAt: "2026-02-09T00:00:00.000Z" }),
      turn({ turnId: "later", completedAt: "2026-02-09T12:00:00.000Z", costUsd: null, costState: "unknown" }),
      turn({ turnId: "live", completedAt: "2026-02-10T00:00:01.000Z" }),
      turn({ turnId: "provisional", confidence: "low", completedAt: "2026-02-09T12:00:00.000Z" }),
    ], "24h", now);
    expect([result.from, result.to]).toEqual([now - 24 * 60 * 60 * 1000, now]);
    expect(result.turns.map((item) => item.turnId)).toEqual(["boundary", "later"]);
    expect(result.costState).toBe("estimated");
  });

  it("distinguishes exact, estimated, free-model, and unknown costs", () => {
    const now = Date.parse("2026-01-11T00:00:00.000Z");
    expect(projectHistoricalUsage([turn({ costUsd: 0 })], "30d", now).costState).toBe("free-model");
    expect(projectHistoricalUsage([turn({ costUsd: 0.1, costState: "partial" })], "30d", now).costState).toBe("estimated");
    expect(projectHistoricalUsage([turn({ costUsd: 0.1 })], "30d", now).costState).toBe("exact");
    expect(projectHistoricalUsage([turn({ costUsd: null, costState: "unknown" })], "30d", now).costState).toBe("unknown");
  });

  it("projects canonical model and workspace analytics without mixing metadata", () => {
    const result = projectHistoricalUsage([
      turn({ turnId: "a", workspaceId: "workspace-b", model: "provider-alias", canonicalModelId: "model-1", provider: "Provider A", displayName: "Friendly model", inputTokens: 100, cachedInputTokens: 25, outputTokens: 20, costUsd: 1 }),
      turn({ turnId: "b", workspaceId: "workspace-a", model: "provider-alias", canonicalModelId: "model-1", provider: "Provider A", displayName: "Friendly model", inputTokens: 50, cachedInputTokens: 25, outputTokens: 10, costUsd: 2 }),
    ], "30d", Date.parse("2026-01-11T00:00:00.000Z"));
    expect(result.models).toEqual([expect.objectContaining({ key: "model-1", provider: "Provider A", displayName: "Friendly model", finalizedTurnCount: 2, cachePercentage: 33.33333333333333, reportedCostUsd: 3, costState: "exact" })]);
    expect(result.workspaces.map(({ key, reportedCostUsd }) => [key, reportedCostUsd])).toEqual([["workspace-a", 2], ["workspace-b", 1]]);
  });

  it("round trips and replaces by full scope and turn identity", async () => {
    const first = storage();
    const store = createUsageTurnStore({ storage: first, now: () => Date.parse("2026-01-11T00:00:00.000Z") });
    await store.put(turn());
    await store.put(turn({ inputTokens: 20 }));
    await store.put(turn({ agentId: "other" }));
    const second = createUsageTurnStore({ storage: first, now: () => Date.parse("2026-01-11T00:00:00.000Z") });
    expect(await second.get({ projectId: "p", workspaceId: "w", agentId: "a" })).toEqual([expect.objectContaining({ inputTokens: 20 })]);
    expect(JSON.parse(first.value!).turns[0]).not.toHaveProperty("prompt");
  });

  it("prunes records at the deterministic thirty-day boundary", async () => {
    const file = storage();
    const nowMs = Date.parse("2026-02-10T00:00:00.000Z");
    const store = createUsageTurnStore({ storage: file, now: () => nowMs });
    await store.put(turn({ turnId: "old", completedAt: "2026-01-10T00:00:00.000Z" }));
    await store.put(turn({ turnId: "new", completedAt: "2026-01-11T00:00:00.000Z" }));
    expect((await store.get({ projectId: "p", workspaceId: "w", agentId: "a" })).map((t) => t.turnId)).toEqual(["new"]);
  });

  it("ignores malformed persisted records safely", async () => {
    const store = createUsageTurnStore({ storage: storage('{"version":1,"turns":[{"prompt":"secret"}]}') });
    expect(await store.get({ projectId: "p", workspaceId: "w", agentId: "a" })).toEqual([]);
  });
});
