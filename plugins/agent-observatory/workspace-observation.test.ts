import { describe, expect, it, vi } from "vitest";
import { WorkspaceObservationController, type ObservatoryPaseoApi } from "./workspace-observation";

describe("WorkspaceObservationController", () => {
  it("publishes subscribed agent changes without a manual refresh and releases resources", async () => {
    const harness = createPaseoHarness();
    const clearInterval = vi.fn();
    const controller = new WorkspaceObservationController(harness.paseo, "workspace-1", {
      setInterval: vi.fn(() => 42),
      clearInterval,
    });
    const snapshots: string[] = [];
    controller.subscribe(() => snapshots.push(controller.getSnapshot().phase));

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: { workspace: { name: "Emerald City" }, agents: [{ id: "agent-1" }] },
    });

    harness.publishAgent({
      kind: "upsert",
      agent: agent("agent-2", "error"),
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: { counts: expect.arrayContaining([{ label: "Failed", count: 1 }]) },
    });
    harness.publishWorkspace({
      kind: "upsert",
      workspace: { id: "workspace-1", name: "Renamed workspace" },
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      view: { workspace: { name: "Renamed workspace" } },
    });
    expect(snapshots).toContain("ready");

    controller.stop();
    expect(harness.unsubscribeWorkspace).toHaveBeenCalledOnce();
    expect(harness.unsubscribeAgent).toHaveBeenCalledOnce();
    expect(clearInterval).toHaveBeenCalledWith(42);
  });

  it("marks a missing selected workspace as unavailable", async () => {
    const harness = createPaseoHarness({ workspaces: [] });
    const controller = new WorkspaceObservationController(harness.paseo, "missing", noTimers());

    await controller.start();

    expect(controller.getSnapshot()).toEqual({
      phase: "unavailable",
      message: "The selected workspace is unavailable on this host.",
    });
  });

  it("distinguishes a disconnected host from other unavailable data", async () => {
    const disconnected = createPaseoHarness({ error: new Error("WebSocket disconnected") });
    const offline = new WorkspaceObservationController(disconnected.paseo, "workspace-1", noTimers());
    await offline.start();
    expect(offline.getSnapshot().phase).toBe("disconnected");

    const unavailable = createPaseoHarness({ error: new Error("Unsupported directory response") });
    const broken = new WorkspaceObservationController(unavailable.paseo, "workspace-1", noTimers());
    await broken.start();
    expect(broken.getSnapshot().phase).toBe("unavailable");
  });

  it("re-establishes directory subscriptions when a disconnected host recovers", async () => {
    const harness = createPaseoHarness({ error: new Error("WebSocket disconnected") });
    let retry = () => undefined;
    const controller = new WorkspaceObservationController(harness.paseo, "workspace-1", {
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
});

function createPaseoHarness(options: {
  workspaces?: Array<{ id: string; name: string }>;
  error?: Error;
} = {}) {
  let workspaceHandler: (update: unknown) => void = () => undefined;
  let agentHandler: (update: unknown) => void = () => undefined;
  const unsubscribeWorkspace = vi.fn();
  const unsubscribeAgent = vi.fn();
  const workspaces = options.workspaces ?? [{ id: "workspace-1", name: "Emerald City" }];
  let currentError = options.error;
  const maybeThrow = () => {
    if (currentError) throw currentError;
  };
  const paseo = {
    workspaces: {
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
        return { entries: [{ agent: agent("agent-1", "running") }] };
      }),
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

function agent(id: string, status: string) {
  return {
    id,
    workspaceId: "workspace-1",
    title: id,
    status,
    updatedAt: "2026-08-22T12:00:00.000Z",
    requiresAttention: false,
    attentionReason: null,
  };
}

function noTimers() {
  return {
    setInterval: vi.fn(() => 42),
    clearInterval: vi.fn(),
  };
}
