import { describe, expect, it } from "vitest";
import {
  ATTENTION_INACTIVITY_THRESHOLD_MS,
  createProjectObservation,
  deriveAttentionQueue,
  normalizeTimelineEntry,
  projectDashboard,
  reduceAgentUsage,
  type AttentionAgentInput,
  type NormalizedTimelineEntry,
  type ObservatoryAgentUsageTurn,
} from "./observation";

describe("projectDashboard", () => {
  it("keeps live usage out of finalized totals and reports cache and cost truthfully", () => {
    const base = { id: "a", workspaceId: "w", title: "A", status: "running", lifecycle: "active" as const, updatedAt: "", parentId: null, parentTitle: null, parentWorkspaceId: null, depth: 0, model: "gpt-4", switchedModels: false };
    let usage = reduceAgentUsage({ finalizedTurns: [], provisionalTurn: null }, { kind: "final", turnId: "1", model: "claude-3", usage: { inputTokens: 10, cachedInputTokens: 12, outputTokens: 5, totalCostUsd: 2 } });
    usage = reduceAgentUsage(usage, { kind: "provisional", turnId: "2", usage: { inputTokens: 100, outputTokens: 100, totalCostUsd: 9 } });
    const dashboard = projectDashboard([{ ...base, usageTurns: [...usage.finalizedTurns, usage.provisionalTurn!] }], [{ id: "w", name: "Main", agents: [] }]);
    expect(dashboard).toMatchObject({ recordedTokens: 15, inputTokens: 10, cachedInputTokens: 10, freshInputTokens: 0, outputTokens: 5, reportedCostUsd: 2, costState: "complete", finalizedTurnCount: 1, workingAgentCount: 1 });
    expect(dashboard.models).toMatchObject([{ model: "claude-3", provider: "Anthropic", totalTokens: 15 }]);
    expect(dashboard.liveTurns).toHaveLength(1);
  });

  it("distinguishes partial and wholly unknown cost and sorts models by totals", () => {
    const turn = (model: string, costUsd: number | null, inputTokens: number, cachedInputTokens: number | null = null) => ({ turnId: null, model, inputTokens, cachedInputTokens, outputTokens: 0, costUsd, contextUsedTokens: null, contextMaxTokens: null, provisional: false });
    const agentBase = (id: string, usageTurns: ObservatoryAgentUsageTurn[]) => ({ id, workspaceId: "w", title: id, status: "closed", lifecycle: "finished" as const, updatedAt: "", parentId: null, parentTitle: null, parentWorkspaceId: null, depth: 0, model: null, usageTurns, switchedModels: false });
    const dashboard = projectDashboard([agentBase("a", [turn("unknown-model", null, 2), turn("known-model", 3, 1, -4)]), agentBase("b", [turn("known-model", 4, 10)])], [{ id: "w", name: "Main", agents: [] }]);
    expect(dashboard.costState).toBe("partial");
    expect(dashboard.reportedCostUsd).toBe(7);
    expect(dashboard.models.map((model) => model.model)).toEqual(["known-model", "unknown-model"]);
    expect(dashboard.models[0]?.provider).toBeNull();
    expect(dashboard.models[0]).toMatchObject({ costState: "complete", cachedInputTokens: 0, freshInputTokens: 11 });
    expect(projectDashboard([agentBase("a", [turn("x", null, 0)])], []).reportedCostUsd).toBeNull();
  });
});

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

  it("nests children across workspaces and keeps filtered parents as roots", () => {
    const view = createProjectObservation({ id: "project-1", name: "Project" }, [workspace("workspace-1", "Main"), workspace("workspace-2", "Feature")], [
      agent("parent", "running", { workspaceId: "workspace-1" }),
      agent("child", "running", { workspaceId: "workspace-2", labels: { "paseo.parent-agent-id": "parent" } }),
    ]);
    expect(view.dashboard.agents.map((item) => [item.id, item.workspaceName, item.depth, item.parentId])).toEqual([
      ["parent", "Main", 0, null], ["child", "Feature", 1, "parent"],
    ]);

    const filtered = createProjectObservation(
      { id: "project-1", name: "Project" },
      [workspace("workspace-1", "Main"), workspace("workspace-2", "Feature")],
      [agent("parent", "running", { workspaceId: "workspace-1" }), agent("child", "running", { workspaceId: "workspace-2", labels: { "paseo.parent-agent-id": "parent" } })],
      { query: "child" },
    );
    expect(filtered.dashboard.agents[0]).toMatchObject({ id: "child", parentId: "parent", parentTitle: "parent", depth: 0 });
  });

  it("keeps self-parenting and cyclic delegation links as deterministic roots", () => {
    const view = createProjectObservation({ id: "project-1", name: "Project" }, [workspace("workspace-1", "Main")], [
      agent("b", "running", { labels: { "paseo.parent-agent-id": "a" } }),
      agent("a", "running", { labels: { "paseo.parent-agent-id": "b" } }),
      agent("self", "running", { labels: { "paseo.parent-agent-id": "self" } }),
    ]);
    expect(view.dashboard.agents.map((item) => [item.id, item.depth, item.parentId])).toEqual([
      ["a", 0, "b"], ["b", 1, "a"], ["self", 0, "self"],
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

describe("deriveAttentionQueue", () => {
  it("collects agents from every active workspace, labels each entry with its workspace, and excludes archived ones", () => {
    const entries = queue([
      { agent: agent("main-worker", "running") },
      { agent: agent("feature-worker", "running", { workspaceId: "workspace-2" }) },
      { agent: agent("archived-worker", "running", { workspaceId: "archived" }) },
      { agent: agent("stranger", "running", { workspaceId: "elsewhere" }) },
    ], BASE + ATTENTION_INACTIVITY_THRESHOLD_MS + MINUTE);

    expect(entries).toMatchObject([
      { agentId: "feature-worker", workspaceId: "workspace-2", workspaceName: "Feature", reason: "inactivity", hintedAt: BASE + ATTENTION_INACTIVITY_THRESHOLD_MS },
      { agentId: "main-worker", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);
  });

  it("raises a user-input hint immediately and clears it when the request is answered", () => {
    const waiting = { agent: agent("asker", "running", { attentionTimestamp: new Date(BASE).toISOString(), pendingPermissions: 1 }) };
    expect(queue([waiting], BASE)).toMatchObject([
      { agentId: "asker", workspaceId: "workspace-1", workspaceName: "Main", reason: "user_input", hintedAt: BASE },
    ]);

    const answered = { agent: agent("asker", "running", { updatedAt: new Date(BASE + MINUTE).toISOString() }), timeline: [entry(BASE + MINUTE)] };
    expect(queue([answered], BASE + ATTENTION_INACTIVITY_THRESHOLD_MS)).toEqual([]);
  });

  it("raises a user-input hint from a permission request event even without daemon attention flags", () => {
    const input = { agent: agent("asker", "running"), timeline: [entry(BASE - 5 * MINUTE, { category: "permission_request", label: "Permission request", progress: true })] };
    expect(queue([input], BASE)[0]).toMatchObject({ agentId: "asker", reason: "user_input", hintedAt: BASE - 5 * MINUTE });
  });

  it("raises terminal failed outcomes but not recovered transient failures", () => {
    const terminal = { agent: agent("broken", "error", { updatedAt: new Date(BASE).toISOString() }) };
    expect(queue([terminal], BASE)[0]).toMatchObject({ agentId: "broken", reason: "failure", hintedAt: BASE });

    const transient = {
      agent: agent("flaky", "running"),
      timeline: [entry(BASE - MINUTE), entry(BASE - 2 * MINUTE, { category: "tool_activity", label: "Tool activity" }), entry(BASE - 3 * MINUTE, { category: "failure", label: "Failure", progress: false })],
    };
    expect(queue([transient], BASE)).toEqual([]);
    expect(queue([transient], BASE + 60 * MINUTE).some((hint) => hint.reason === "failure")).toBe(false);

    const escalated = {
      agent: agent("stuck-flaky", "running"),
      timeline: [entry(BASE - 3 * MINUTE, { category: "failure", label: "Failure", progress: false })],
    };
    expect(queue([escalated], BASE - 3 * MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS)[0]).toMatchObject({ agentId: "stuck-flaky", reason: "failure" });
  });

  it("raises inactivity only after the fixed non-configurable 15 minutes without meaningful progress", () => {
    const worker = { agent: agent("worker", "running"), timeline: [entry(BASE - ATTENTION_INACTIVITY_THRESHOLD_MS + MINUTE)] };
    expect(queue([worker], BASE - ATTENTION_INACTIVITY_THRESHOLD_MS + MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS - 1)).toEqual([]);
    expect(queue([worker], BASE - ATTENTION_INACTIVITY_THRESHOLD_MS + MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS)).toMatchObject([
      { agentId: "worker", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE + MINUTE },
    ]);
  });

  it("resets inactivity for progress-reporting heartbeats but not for silent ones", () => {
    const beatAt = BASE - 30 * MINUTE;
    const progressing = {
      agent: agent("beating", "running"),
      timeline: [entry(beatAt, { category: "other", label: "Heartbeat", heartbeat: true, progress: true })],
    };
    expect(queue([progressing], BASE)).toMatchObject([
      { agentId: "beating", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: beatAt + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);

    const silent = {
      agent: agent("silent-beat", "running"),
      timeline: [entry(beatAt, { category: "other", label: "Heartbeat", heartbeat: true, progress: false })],
    };
    expect(queue([silent], BASE)).toEqual([]);
    expect(queue([silent], BASE + ATTENTION_INACTIVITY_THRESHOLD_MS + MINUTE)).toMatchObject([
      { agentId: "silent-beat", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);
  });

  it("pauses inactivity during an observable long-running operation and resumes after it completes", () => {
    const running = {
      agent: agent("builder", "running"),
      timeline: [entry(BASE - 30 * MINUTE, { category: "message" }), entry(BASE - 20 * MINUTE, { category: "tool_activity", label: "Tool activity", longRunning: true })],
    };
    expect(queue([running], BASE + 60 * MINUTE)).toEqual([]);

    const finished = {
      agent: agent("builder", "running"),
      timeline: [entry(BASE - 10 * MINUTE, { category: "tool_activity", label: "Tool activity" }), entry(BASE - 20 * MINUTE, { category: "tool_activity", label: "Tool activity", longRunning: true })],
    };
    expect(queue([finished], BASE + 4 * MINUTE)).toEqual([]);
    expect(queue([finished], BASE + 5 * MINUTE)).toMatchObject([
      { agentId: "builder", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE - 10 * MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);
  });

  it("pauses inactivity while an active observable child dependency works and resumes when it finishes", () => {
    const parent = { agent: agent("parent", "running") };
    const delegated = { agent: agent("child", "running", { labels: { "paseo.parent-agent-id": "parent" } }), timeline: [entry(BASE + 89 * MINUTE)] };
    expect(queue([parent, delegated], BASE + 90 * MINUTE)).toEqual([]);

    const done = { agent: agent("child", "closed", { labels: { "paseo.parent-agent-id": "parent" } }) };
    expect(queue([parent, done], BASE + 90 * MINUTE)).toMatchObject([
      { agentId: "parent", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);
  });

  it("produces exactly one primary reason per agent ordered user input, failure, then inactivity", () => {
    const everything = {
      agent: agent("needy", "error", { requiresAttention: true, attentionReason: "permission", attentionTimestamp: new Date(BASE - MINUTE).toISOString(), pendingPermissions: 2 }),
      timeline: [
        entry(BASE - 40 * MINUTE, { category: "failure", label: "Failure", progress: false }),
        entry(BASE - 60 * MINUTE),
      ],
    };
    for (let tick = BASE; tick <= BASE + 120 * MINUTE; tick += 15 * MINUTE) {
      expect(queue([everything], tick)).toMatchObject([
        { agentId: "needy", workspaceId: "workspace-1", workspaceName: "Main", reason: "user_input", hintedAt: BASE - MINUTE },
      ]);
    }
  });

  it("sorts the queue by reason priority and then oldest hint first", () => {
    const inputs = [
      { agent: agent("late-input", "running", { attentionTimestamp: new Date(BASE - MINUTE).toISOString(), pendingPermissions: 1 }) },
      { agent: agent("old-failure", "error", { updatedAt: new Date(BASE - 10 * MINUTE).toISOString(), workspaceId: "workspace-2" }) },
      { agent: agent("new-failure", "error", { updatedAt: new Date(BASE - 2 * MINUTE).toISOString() }) },
      { agent: agent("sleepy", "running"), timeline: [entry(BASE - 30 * MINUTE)] },
      { agent: agent("idle-runner", "running", { workspaceId: "workspace-2" }), timeline: [entry(BASE - 45 * MINUTE)] },
    ];
    expect(queue(inputs, BASE)).toMatchObject([
      { agentId: "late-input", workspaceId: "workspace-1", workspaceName: "Main", reason: "user_input", hintedAt: BASE - MINUTE },
      { agentId: "old-failure", workspaceId: "workspace-2", workspaceName: "Feature", reason: "failure", hintedAt: BASE - 10 * MINUTE },
      { agentId: "new-failure", workspaceId: "workspace-1", workspaceName: "Main", reason: "failure", hintedAt: BASE - 2 * MINUTE },
      { agentId: "idle-runner", workspaceId: "workspace-2", workspaceName: "Feature", reason: "inactivity", hintedAt: BASE - 45 * MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS },
      { agentId: "sleepy", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: BASE - 30 * MINUTE + ATTENTION_INACTIVITY_THRESHOLD_MS },
    ]);
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
    attentionTimestamp: string | null;
    pendingPermissions: number;
    createdAt: string;
    updatedAt: string;
    labels: Record<string, string>;
  }> = {},
) {
  return {
    id,
    workspaceId: "workspace-1",
    title: id,
    status,
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    pendingPermissions: 0,
    labels: {},
    ...overrides,
  };
}

const MINUTE = 60_000;
const BASE = Date.parse("2026-08-22T12:00:00.000Z");

function entry(at: number, overrides: Partial<NormalizedTimelineEntry> & { category?: NormalizedTimelineEntry["category"] } = {}): NormalizedTimelineEntry {
  return { category: "message", label: "Message", summary: "", at: new Date(at).toISOString(), progress: true, ...overrides };
}

function queue(
  agents: AttentionAgentInput[],
  now: number,
  workspaces = [workspace("workspace-1", "Main"), workspace("workspace-2", "Feature"), workspace("archived", "Old Oz", { archivingAt: "2026-08-22T12:00:00.000Z" })],
) {
  return deriveAttentionQueue({ project: { id: "project-1", name: "Emerald City" }, workspaces, agents, now });
}

