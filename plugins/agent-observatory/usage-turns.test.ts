import { describe, expect, it } from "vitest";
import { createUsageTurnStore, type UsageTurnFileStorage, type NormalizedUsageTurn } from "./usage-turns";

function storage(initial: string | null = null): UsageTurnFileStorage & { value: string | null } {
  return { value: initial, async read() { return this.value; }, async write(data) { this.value = data; } };
}
function turn(overrides: Partial<NormalizedUsageTurn> = {}): NormalizedUsageTurn {
  return { projectId: "p", workspaceId: "w", agentId: "a", turnId: "t", observedAt: "2026-01-10T00:00:00.000Z", startedAt: null, completedAt: "2026-01-10T00:00:00.000Z", model: "model", inputTokens: 10, cachedInputTokens: 2, outputTokens: 3, contextUsedTokens: null, contextMaxTokens: null, costUsd: 0.1, costState: "complete", confidence: "high", ...overrides };
}

describe("usage turn store", () => {
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
