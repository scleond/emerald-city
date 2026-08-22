import { describe, expect, it } from "vitest";
import {
  aggregateModelUsage,
  agentUsageTurns,
  createProjectObservation,
  emptyAgentUsage,
  normalizeTimelineEntry,
  reduceAgentUsage,
  type ObservatoryAgentUsageTurn,
} from "./observation";

describe("aggregateModelUsage", () => {
  it("treats cached input as a subset of input and totals input plus output per model", () => {
    const bars = aggregateModelUsage([
      usageAgent("a", "model-a", [
        finalTurn("model-a", { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 }),
      ]),
      usageAgent("b", "model-a", [
        finalTurn("model-a", { inputTokens: 500, cachedInputTokens: 100, outputTokens: 50 }),
        finalTurn(null, { inputTokens: 10, outputTokens: 5 }),
      ]),
    ]);

    expect(bars).toEqual([
      {
        model: "model-a",
        freshInputTokens: 1010,
        cachedInputTokens: 500,
        outputTokens: 255,
        totalTokens: 1765,
      },
    ]);
    expect(bars[0].totalTokens).toBe(1000 + 500 + 10 + 200 + 50 + 5);
  });

  it("segregates usage by model and excludes provisional live turns from totals", () => {
    const record = reduceAgentUsage(
      reduceAgentUsage(
        reduceAgentUsage(emptyAgentUsage(), {
          kind: "provisional",
          turnId: "turn-1",
          usage: { inputTokens: 900, outputTokens: 100 },
        }),
        { kind: "provisional", turnId: "turn-1", usage: { inputTokens: 1200, outputTokens: 150 } },
      ),
      {
        kind: "final",
        turnId: "turn-1",
        model: "model-a",
        usage: { inputTokens: 1500, cachedInputTokens: 300, outputTokens: 200 },
      },
    );

    expect(agentUsageTurns(record)).toHaveLength(1);
    const bars = aggregateModelUsage([usageAgent("a", null, record.finalizedTurns)]);
    expect(bars).toEqual([
      {
        model: "model-a",
        freshInputTokens: 1200,
        cachedInputTokens: 300,
        outputTokens: 200,
        totalTokens: 1700,
      },
    ]);
  });
});

describe("createProjectObservation usage", () => {
  it("flags agents that switched models across finalized turns and skips archived workspaces", () => {
    const view = createProjectObservation(
      { id: "project-1", name: "Emerald City" },
      [workspace("workspace-1", "Main"), workspace("archived", "Old", { archivingAt: "2026-08-22T12:00:00.000Z" })],
      [
        {
          ...agent("switcher", "running"),
          model: "model-a",
          usage: {
            finalizedTurns: [
              { ...finalTurn("model-a", { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5 }), turnId: "t1" },
              { ...finalTurn("model-b", { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5 }), turnId: "t2" },
            ],
            provisionalTurn: null,
          },
        },
        {
          ...agent("steady", "idle"),
          model: "model-a",
          usage: {
            finalizedTurns: [
              { ...finalTurn("model-a", { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5 }), turnId: "t3" },
              { ...finalTurn("model-a", { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5 }), turnId: "t4" },
            ],
            provisionalTurn: null,
          },
        },
        { ...agent("archived-agent", "running"), workspaceId: "archived" },
      ],
    );

    const switcher = view.workspaces[0].agents.find(({ id }) => id === "switcher")!;
    const steady = view.workspaces[0].agents.find(({ id }) => id === "steady")!;
    expect(switcher.switchedModels).toBe(true);
    expect(steady.switchedModels).toBe(false);
    expect(view.workspaces[0].agents.find(({ id }) => id === "archived-agent")).toBeUndefined();
    expect(view.models.map(({ model, totalTokens }) => ({ model, totalTokens }))).toEqual([
      { model: "model-a", totalTokens: 45 },
      { model: "model-b", totalTokens: 15 },
    ]);
  });
});

const finalTurn = (
  model: string | null,
  usage: Partial<{ inputTokens: number; cachedInputTokens: number; outputTokens: number }> = {},
) => ({
  turnId: `turn-${Math.random()}`,
  model,
  inputTokens: usage.inputTokens ?? 0,
  cachedInputTokens: usage.cachedInputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  costUsd: 0.01,
  contextUsedTokens: null,
  contextMaxTokens: null,
  provisional: false,
});

function usageAgent(
  id: string,
  model: string | null,
  finalizedTurns: ObservatoryAgentUsageTurn[],
) {
  return { id, model, usage: { finalizedTurns, provisionalTurn: null } };
}

describe("createProjectObservation", () => {
  it("groups agents by active workspace and summarizes every lifecycle state", () => {
    const view = createProjectObservation(
      { id: "project-1", name: "Emerald City" },
      [
        workspace("workspace-2", "Yellow Brick Road"),
        workspace("workspace-1", "Emerald City"),
        workspace("archived", "Old Oz", { archivingAt: "2026-08-22T12:00:00.000Z" }),
        workspace("other-project", "Kansas", { projectId: "project-2" }),
      ],
      [
        agent("active", "running", { workspaceId: "workspace-1" }),
        agent("starting", "initializing", { workspaceId: "workspace-2" }),
        agent("waiting", "idle", {
          workspaceId: "workspace-1",
          requiresAttention: true,
          attentionReason: "permission",
        }),
        agent("finished", "closed", { workspaceId: "workspace-2" }),
        agent("failed", "error", { workspaceId: "workspace-1" }),
        agent("future", "hibernating", { workspaceId: "workspace-2" }),
        agent("archived-agent", "running", { workspaceId: "archived" }),
        agent("other-agent", "running", { workspaceId: "other-project" }),
      ],
    );

    expect(view.counts).toEqual([
      { label: "Active", count: 2 },
      { label: "Waiting", count: 1 },
      { label: "Finished", count: 1 },
      { label: "Failed", count: 1 },
      { label: "Other", count: 1 },
    ]);
    expect(view.workspaces.map(({ id }) => id)).toEqual(["workspace-1", "workspace-2"]);
    expect(view.workspaces[0]?.agents.map(({ id }) => id)).toEqual([
      "active",
      "waiting",
      "failed",
    ]);
    expect(view.workspaces[1]?.agents).toContainEqual(
      expect.objectContaining({ id: "future", lifecycle: "other", status: "hibernating" }),
    );
  });

  it("keeps active workspaces visible when the project has no agents", () => {
    const view = createProjectObservation(
      { id: "project-1", name: "Empty" },
      [workspace("workspace-1", "Main")],
      [],
    );

    expect(view.counts.every(({ count }) => count === 0)).toBe(true);
    expect(view.workspaces).toEqual([{ id: "workspace-1", name: "Main", agents: [] }]);
  });

  it("nests delegated children and preserves unknown parents", () => {
    const view = createProjectObservation({ id: "project-1", name: "Project" }, [workspace("workspace-1", "Main")], [
      agent("child", "running", { labels: { "paseo.parent-agent-id": "parent" } }),
      agent("parent", "running"),
      agent("orphan", "running", { labels: { "paseo.parent-agent-id": "missing" } }),
    ]);
    expect(view.workspaces[0]?.agents.map((item) => [item.id, item.depth, item.parentTitle])).toEqual([
      ["orphan", 0, null], ["parent", 0, null], ["child", 1, "parent"],
    ]);
  });

  it("normalizes supported and unknown timeline activity", () => {
    expect(normalizeTimelineEntry({ item: { type: "user_message", text: "hello" } }).category).toBe("message");
    expect(normalizeTimelineEntry({ item: { type: "tool_call", status: "ok" } }).category).toBe("tool_activity");
    expect(normalizeTimelineEntry({ item: { type: "error" } }).category).toBe("failure");
    expect(normalizeTimelineEntry({ item: { type: "provider_secret" } }).label).toBe("Other activity");
  });

  it("filters by workspace or agent query and lifecycle", () => {
    const view = createProjectObservation({ id: "project-1", name: "Project" }, [workspace("workspace-1", "Main"), workspace("workspace-2", "Docs")], [
      agent("writer", "running", { workspaceId: "workspace-1" }), agent("reviewer", "idle", { workspaceId: "workspace-2" }),
    ], { query: "docs", lifecycles: ["finished"] });
    expect(view.workspaces.map((item) => item.id)).toEqual(["workspace-2", "workspace-1"]);
    expect(view.workspaces[0]?.agents.map((item) => item.id)).toEqual(["reviewer"]);
    expect(view.counts.find((item) => item.label === "Active")?.count).toBe(1);
  });
});

function workspace(
  id: string,
  name: string,
  overrides: Partial<{ projectId: string; archivingAt: string | null }> = {},
) {
  return {
    id,
    projectId: "project-1",
    name,
    archivingAt: null,
    ...overrides,
  };
}

function agent(
  id: string,
  status: string,
  overrides: Partial<{
    workspaceId: string;
    requiresAttention: boolean;
    attentionReason: string | null;
    labels: Record<string, string>;
  }> = {},
) {
  return {
    id,
    workspaceId: "workspace-1",
    title: id,
    status,
    updatedAt: "2026-08-22T12:00:00.000Z",
    requiresAttention: false,
    attentionReason: null,
    model: null,
    labels: {},
    ...overrides,
  };
}
