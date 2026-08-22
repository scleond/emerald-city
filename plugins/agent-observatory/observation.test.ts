import { describe, expect, it } from "vitest";
import { createProjectObservation } from "./observation";

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
    ...overrides,
  };
}
