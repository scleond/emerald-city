import { describe, expect, it } from "vitest";
import { createWorkspaceObservation } from "./observation";

describe("createWorkspaceObservation", () => {
  it("summarizes every lifecycle state and keeps unknown states visible", () => {
    const view = createWorkspaceObservation(
      { id: "workspace-1", name: "Emerald City" },
      [
        agent("active", "running"),
        agent("starting", "initializing"),
        agent("waiting", "idle", { requiresAttention: true, attentionReason: "permission" }),
        agent("finished", "closed"),
        agent("failed", "error"),
        agent("future", "hibernating"),
      ],
    );

    expect(view.counts).toEqual([
      { label: "Active", count: 2 },
      { label: "Waiting", count: 1 },
      { label: "Finished", count: 1 },
      { label: "Failed", count: 1 },
      { label: "Other", count: 1 },
    ]);
    expect(view.agents.map(({ id, lifecycle, status }) => ({ id, lifecycle, status }))).toContainEqual(
      { id: "future", lifecycle: "other", status: "hibernating" },
    );
  });

  it("returns an empty agent list without inventing lifecycle counts", () => {
    const view = createWorkspaceObservation({ id: "workspace-1", name: "Empty" }, []);

    expect(view.counts.every(({ count }) => count === 0)).toBe(true);
    expect(view.agents).toEqual([]);
  });
});

function agent(
  id: string,
  status: string,
  overrides: Partial<{
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
