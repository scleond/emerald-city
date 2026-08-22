import { describe, expect, it, vi } from "vitest";
import { ProjectObservationController, type ObservatoryPaseoApi } from "./project-observation";

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
    let retry = () => undefined;
    const controller = new ProjectObservationController(harness.paseo, "workspace-1", {
      setInterval: vi.fn((callback) => {
        retry = callback;
        return 42;
      }),
      clearInterval: vi.fn(),
    });
    await controller.start();
    expect(controller.getSnapshot().phase).toBe("disconnected");

    harness.recover();
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
    recover: () => {
      currentError = undefined;
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
