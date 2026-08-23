import { describe, expect, it, vi } from "vitest";
import { ProjectObservationController, type ObservatoryPaseoApi } from "./project-observation";
import type { NormalizedUsageTurn, UsageTurnStore } from "./usage-turns";

describe("ProjectObservationController", () => {
  it("publishes project agents grouped by active workspace and releases resources", async () => {
    const harness = createPaseoHarness();
    const clearInterval = vi.fn();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", {
      setInterval: vi.fn(() => 42),
      clearInterval,
    });
    const snapshots: string[] = [];
    controller.subscribe(() => snapshots.push(controller.getSnapshot().phase));

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: {
        project: { id: "project-1", name: "Emerald City" },
        workspaces: [
          { id: "workspace-2", agents: [{ id: "agent-2" }] },
          { id: "workspace-1", agents: [{ id: "agent-1" }] },
        ],
      },
    });
    expect(harness.paseo.workspaces.list).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { projectId: "project-1" }, subscribe: {} }),
    );

    harness.publishAgent({
      kind: "upsert",
      agent: agent("agent-3", "error", { workspaceId: "workspace-2" }),
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: { counts: expect.arrayContaining([{ label: "Failed", count: 1 }]) },
    });
    harness.publishWorkspace({
      kind: "upsert",
      workspace: workspace("workspace-2", "Renamed worktree", { projectDisplayName: "Renamed project" }),
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: {
        project: { name: "Renamed project" },
        workspaces: expect.arrayContaining([
          expect.objectContaining({ name: "Renamed worktree" }),
        ]),
      },
    });
    expect(snapshots).toContain("ready");

    controller.stop();
    expect(harness.unsubscribeWorkspace).toHaveBeenCalledOnce();
    expect(harness.unsubscribeAgent).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(42);
  });

  it("projects finalized usage received from a completed turn", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "turn-1", usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 3, totalCostUsd: 0.12 } } });
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", view: { dashboard: { recordedTokens: 13, reportedCostUsd: 0.12 } } });
    const snapshot = controller.getSnapshot();
    if (snapshot.phase === "ready") expect(snapshot.view.dashboard.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: "agent-1", usage: expect.objectContaining({ recordedTokens: 13 }) })]));
    controller.stop();
  });

  it("marks a completed event without usage as not reported", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "turn-without-usage" } });
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", telemetry: { type: "turn_completed", turnId: "turn-without-usage", health: "not-reported", usagePresent: false } });
    controller.stop();
  });

  it("marks null and empty usage as not reported", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "usage_updated", usage: null } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { health: "not-reported" } });
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", usage: {} } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { health: "not-reported" } });
    controller.stop();
  });

  it("isolates malformed stream events and keeps valid telemetry flowing", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    harness.publishTimeline("agent-1", null);
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: { secret: "nope" }, usage: { inputTokens: "not-a-number", prompt: "do not retain" } } });
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "valid", usage: { inputTokens: 4 } } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { type: "turn_completed", turnId: "valid", usageFields: ["inputTokens"] }, view: { dashboard: { recordedTokens: 4 } } });
    controller.stop();
  });

  it("ignores unknown and inherited usage fields in telemetry diagnostics", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    const usage = Object.create({ toString: 99 });
    usage.unknownTokens = 10;
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", usage } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { usagePresent: false, health: "not-reported", usageFields: [] } });
    controller.stop();
  });

  it("publishes model changes even with malformed runtime info", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.start();
    listener.mockClear();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "model_changed", runtimeInfo: "malformed" } });
    expect(listener).toHaveBeenCalled();
    controller.stop();
  });

  it("makes lifecycle calls idempotent", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    await controller.start();
    expect(harness.paseo.agents.subscribe).toHaveBeenCalledOnce();
    controller.stop();
    controller.stop();
    expect(harness.unsubscribeAgent).toHaveBeenCalledOnce();
  });

  it("records the last successful telemetry time and marks it stale using the injected clock", async () => {
    let clock = Date.parse("2026-08-22T12:00:00.000Z");
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), () => clock);
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "fresh", usage: { inputTokens: 1 } } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { lastSuccessAt: clock, stale: false } });
    clock += 60_001;
    controller.setFilters("");
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { lastSuccessAt: Date.parse("2026-08-22T12:00:00.000Z"), stale: true } });
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "recovered", usage: { inputTokens: 2 } } });
    expect(controller.getSnapshot()).toMatchObject({ telemetry: { lastSuccessAt: clock, stale: false } });
    controller.stop();
  });

  it("persists live turns and replaces a provisional turn by identity", async () => {
    const stored: NormalizedUsageTurn[] = [];
    const usageStore: UsageTurnStore = {
      async get(scope) { return stored.filter((turn) => turn.projectId === scope.projectId && turn.workspaceId === scope.workspaceId && turn.agentId === scope.agentId); },
      async put(turn) {
        const index = stored.findIndex((candidate) => candidate.projectId === turn.projectId && candidate.workspaceId === turn.workspaceId && candidate.agentId === turn.agentId && candidate.turnId === turn.turnId);
        if (index >= 0) stored[index] = turn; else stored.push(turn);
        return stored;
      },
    };
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), undefined, undefined, usageStore);
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "usage_updated", turnId: "turn-1", usage: { inputTokens: 10 } } });
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", turnId: "turn-1", usage: { inputTokens: 12, outputTokens: 3 } } });
    await vi.waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0]).toMatchObject({ turnId: "turn-1", confidence: "high", inputTokens: 12, outputTokens: 3 });
    controller.stop();
  });

  it("uses one persistence identity for anonymous provisional and final events", async () => {
    const stored: NormalizedUsageTurn[] = [];
    const usageStore: UsageTurnStore = { async get() { return stored; }, async put(turn) { const index = stored.findIndex((item) => item.turnId === turn.turnId); if (index >= 0) stored[index] = turn; else stored.push(turn); return stored; } };
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), undefined, undefined, usageStore);
    await controller.start();
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "usage_updated", model: "model", usage: { inputTokens: 10 } } });
    harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type: "turn_completed", model: "model", usage: { inputTokens: 10 } } });
    await vi.waitFor(() => expect(stored).toHaveLength(1));
    expect(stored[0]).toMatchObject({ turnId: "fallback:model:[[\"inputTokens\",10]]::", confidence: "high" });
    controller.stop();
  });

  it("reconciles interleaved anonymous provisional turns independently", async () => {
    const stored: NormalizedUsageTurn[] = [];
    const usageStore: UsageTurnStore = { async get() { return stored; }, async put(turn) { const index = stored.findIndex((item) => item.turnId === turn.turnId); if (index >= 0) stored[index] = turn; else stored.push(turn); return stored; } };
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), undefined, undefined, usageStore);
    await controller.start();
    const emit = (type: string, usage: { inputTokens: number; outputTokens?: number }) => harness.publishTimeline("agent-1", { agentId: "agent-1", event: { type, model: "model", usage } });
    emit("usage_updated", { inputTokens: 10 });
    emit("usage_updated", { inputTokens: 20 });
    emit("turn_completed", { inputTokens: 10 });
    emit("turn_completed", { inputTokens: 20 });
    await vi.waitFor(() => expect(stored).toHaveLength(2));
    expect(stored.map((turn) => turn.turnId).sort()).toHaveLength(2);
    controller.stop();
  });

  it("backfills usage from historical timeline entries", async () => {
    const harness = createPaseoHarness({ agents: [agent("agent-1", "running", { workspaceId: "workspace-1" })], workspaces: [workspace("workspace-1", "Main")], timeline: [{ item: { type: "turn_completed", turnId: "historical-1", usage: { inputTokens: 20, cachedInputTokens: 5, outputTokens: 4, totalCostUsd: 0.2 } } }] });
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", view: { dashboard: { recordedTokens: 24, reportedCostUsd: 0.2 } } });
    controller.stop();
  });

  it("keeps the project view when the opening workspace is archived", async () => {
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();

    harness.publishWorkspace({ kind: "remove", id: "workspace-1" });

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: {
        project: { id: "project-1" },
        workspaces: [{ id: "workspace-2", agents: [{ id: "agent-2" }] }],
      },
    });
    controller.stop();
  });

  it("excludes archived workspaces and marks a project without active workspaces unavailable", async () => {
    const harness = createPaseoHarness({
      workspaces: [
        workspace("workspace-1", "Main"),
        workspace("workspace-2", "Archived", { archivingAt: "2026-08-22T12:00:00.000Z" }),
      ],
    });
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers());
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: { workspaces: [{ id: "workspace-1" }] },
    });

    harness.publishWorkspace({ kind: "remove", id: "workspace-1" });
    expect(controller.getSnapshot()).toEqual({
      phase: "unavailable",
      message: "This project has no active workspaces on the selected host.",
    });
    controller.stop();
  });

  it("marks a missing opening workspace as unavailable", async () => {
    const harness = createPaseoHarness({ openingWorkspace: null });
    const controller = new ProjectObservationController(harness.paseo, "missing", noTimers());

    await controller.start();

    expect(controller.getSnapshot()).toEqual({
      phase: "unavailable",
      message: "The opening workspace is unavailable on this host.",
    });
    controller.stop();
  });

  it("distinguishes a disconnected host from other unavailable data", async () => {
    const disconnected = createPaseoHarness({ error: new Error("WebSocket disconnected") });
    const offline = new ProjectObservationController(disconnected.paseo, "workspace-1", noTimers());
    await offline.start();
    expect(offline.getSnapshot().phase).toBe("disconnected");
    offline.stop();

    const unavailable = createPaseoHarness({ error: new Error("Unsupported directory response") });
    const broken = new ProjectObservationController(unavailable.paseo, "workspace-1", noTimers());
    await broken.start();
    expect(broken.getSnapshot().phase).toBe("unavailable");
    broken.stop();
  });

  it("re-establishes directory subscriptions when a disconnected host recovers", async () => {
    const harness = createPaseoHarness({ error: new Error("WebSocket disconnected") });
    let clock = 0;
    let retry = () => undefined;
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", {
      setInterval: vi.fn((callback) => {
        retry = callback;
        return 42;
      }),
      clearInterval: vi.fn(),
    }, () => clock);
    await controller.start();
    expect(controller.getSnapshot().phase).toBe("disconnected");

    harness.recover();
    clock = 1_000;
    retry();
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("ready"));

    expect(harness.paseo.workspaces.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ subscribe: {} }),
    );
    expect(harness.paseo.agents.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ subscribe: {} }),
    );
    controller.stop();
  });

  it("backs off recoverable refreshes, exposes exhaustion, and retries again when the window opens", async () => {
    let clock = 0;
    let retry = () => undefined;
    const harness = createPaseoHarness();
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", {
      setInterval: vi.fn((callback) => { retry = callback; return 42; }),
      clearInterval: vi.fn(),
    }, () => clock);
    await controller.start();
    harness.fail(new Error("WebSocket disconnected"));
    const tick = async () => { retry(); await new Promise((resolve) => setTimeout(resolve, 0)); };

    clock = 999;
    await tick();
    await vi.waitFor(() => expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().phase).toBe("ready");
    clock = 1_999;
    await tick();
    expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(3);

    clock = 2_999;
    await tick();
    expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(3);
    clock = 3_999;
    await tick();
    await vi.waitFor(() => expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(4));
    clock = 7_999;
    await tick();
    await vi.waitFor(() => expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(5));

    harness.recover();
    clock = 15_999;
    await tick();
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("ready"));
    expect(harness.paseo.workspaces.list).toHaveBeenCalledTimes(6);
    controller.stop();
  });

  it("raises attention hints immediately for permission requests and clears them on resume", async () => {
    const fixedNow = Date.parse("2026-08-22T12:00:00.000Z");
    const iso = (value: number) => new Date(value).toISOString();
    const harness = createPaseoHarness({
      agents: [agent("agent-1", "running", { workspaceId: "workspace-1" })],
    });
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), () => fixedNow);
    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", attention: [] });

    harness.publishAgent({
      kind: "upsert",
      agent: agent("agent-1", "running", {
        workspaceId: "workspace-1",
        requiresAttention: true,
        attentionReason: "permission",
        attentionTimestamp: iso(fixedNow),
        pendingPermissions: 1,
      }),
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      attention: [
        { agentId: "agent-1", workspaceId: "workspace-1", workspaceName: "Main", reason: "user_input", hintedAt: fixedNow },
      ],
    });

    harness.publishAgent({ kind: "upsert", agent: agent("agent-1", "running", { workspaceId: "workspace-1" }) });
    expect(controller.getSnapshot()).toMatchObject({ phase: "ready", attention: [] });
    controller.stop();
  });

  it("derives inactivity hints from the fixed threshold using the injected clock and timeline summaries", async () => {
    let clock = Date.parse("2026-08-22T11:59:00.000Z");
    const progressAt = new Date(clock).toISOString();
    const harness = createPaseoHarness({
      agents: [agent("agent-1", "running", { workspaceId: "workspace-1", createdAt: progressAt, updatedAt: progressAt })],
      timeline: [{ item: { type: "assistant_message", text: "working" }, timestamp: progressAt }],
    });
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", noTimers(), () => clock);
    await controller.start();
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({ phase: "ready", attention: [] }));

    clock += 15 * 60_000;
    harness.publishAgent({ kind: "upsert", agent: agent("agent-1", "running", { workspaceId: "workspace-1", createdAt: progressAt, updatedAt: progressAt }) });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      attention: [
        { agentId: "agent-1", workspaceId: "workspace-1", workspaceName: "Main", reason: "inactivity", hintedAt: clock },
      ],
    });
    controller.stop();
  });
});

function createPaseoHarness(options: {
  workspaces?: ReturnType<typeof workspace>[];
  openingWorkspace?: ReturnType<typeof workspace> | null;
  agents?: ReturnType<typeof agent>[];
  timeline?: { item?: unknown; timestamp?: string }[];
  error?: Error;
} = {}) {
  let workspaceHandler: (update: unknown) => void = () => undefined;
  let agentHandler: (update: unknown) => void = () => undefined;
  const timelineHandlers = new Map<string, (payload: unknown) => void>();
  const unsubscribeWorkspace = vi.fn();
  const unsubscribeAgent = vi.fn();
  const workspaces = options.workspaces ?? [
    workspace("workspace-1", "Main"),
    workspace("workspace-2", "Feature"),
  ];
  const agents = options.agents ?? [
    agent("agent-1", "running", { workspaceId: "workspace-1" }),
    agent("agent-2", "idle", { workspaceId: "workspace-2" }),
  ];
  const openingWorkspace =
    options.openingWorkspace === undefined ? workspaces[0] ?? null : options.openingWorkspace;
  let currentError = options.error;
  const maybeThrow = () => {
    if (currentError) throw currentError;
  };
  const paseo = {
    workspaces: {
      ref: vi.fn(() => ({
        refresh: vi.fn(async () => {
          maybeThrow();
          return openingWorkspace;
        }),
      })),
      list: vi.fn(async () => {
        maybeThrow();
        return { entries: workspaces };
      }),
      subscribe: vi.fn((handler: (update: unknown) => void) => {
        workspaceHandler = handler;
        return unsubscribeWorkspace;
      }),
    },
    agents: {
      list: vi.fn(async () => {
        maybeThrow();
        return { entries: agents.map((agent) => ({ agent })) };
      }),
      ref: vi.fn(() => ({
        timeline: {
          subscribe: vi.fn((handler: (payload: unknown) => void) => { timelineHandlers.set("agent-1", handler); return vi.fn(); }),
          refetch: vi.fn(async () => {
            maybeThrow();
            return { entries: options.timeline ?? [], pageInfo: { hasOlder: false } };
          }),
        },
      })),
      subscribe: vi.fn((handler: (update: unknown) => void) => {
        agentHandler = handler;
        return unsubscribeAgent;
      }),
    },
  } as unknown as ObservatoryPaseoApi;

  return {
    paseo,
    unsubscribeWorkspace,
    unsubscribeAgent,
    publishWorkspace: (update: unknown) => workspaceHandler(update),
    publishAgent: (update: unknown) => agentHandler(update),
    publishTimeline: (agentId: string, payload: unknown) => timelineHandlers.get(agentId)?.(payload),
    recover: () => {
      currentError = undefined;
    },
    fail: (error: Error) => {
      currentError = error;
    },
  };
}

function workspace(
  id: string,
  name: string,
  overrides: Partial<{
    projectId: string;
    projectDisplayName: string;
    archivingAt: string | null;
  }> = {},
) {
  return {
    id,
    projectId: "project-1",
    projectDisplayName: "Emerald City",
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
    ...overrides,
  };
}

function noTimers() {
  return {
    setInterval: vi.fn(() => 42),
    clearInterval: vi.fn(),
  };
}
