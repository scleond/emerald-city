export type AgentLifecycle = "active" | "waiting" | "finished" | "failed" | "other";

export interface ObservatoryWorkspace {
  id: string;
  name: string;
}

export interface ObservatoryAgentSnapshot {
  id: string;
  workspaceId: string;
  title: string | null;
  status: string;
  updatedAt: string;
  requiresAttention: boolean;
  attentionReason: string | null;
}

export interface ObservatoryAgentView {
  id: string;
  title: string;
  status: string;
  lifecycle: AgentLifecycle;
  updatedAt: string;
}

export interface LifecycleCount {
  label: "Active" | "Waiting" | "Finished" | "Failed" | "Other";
  count: number;
}

export interface ObservatoryViewModel {
  workspace: ObservatoryWorkspace;
  counts: LifecycleCount[];
  agents: ObservatoryAgentView[];
}

const lifecycleOrder: AgentLifecycle[] = ["active", "waiting", "failed", "finished", "other"];

export function createWorkspaceObservation(
  workspace: ObservatoryWorkspace,
  snapshots: readonly ObservatoryAgentSnapshot[],
): ObservatoryViewModel {
  const agents = snapshots
    .filter((agent) => agent.workspaceId === workspace.id)
    .map((agent) => ({
      id: agent.id,
      title: agent.title?.trim() || agent.id,
      status: agent.status,
      lifecycle: lifecycleFor(agent),
      updatedAt: agent.updatedAt,
    }))
    .sort((left, right) => {
      const lifecycleDifference =
        lifecycleOrder.indexOf(left.lifecycle) - lifecycleOrder.indexOf(right.lifecycle);
      return lifecycleDifference || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    });

  const count = (lifecycle: AgentLifecycle) =>
    agents.reduce((total, agent) => total + Number(agent.lifecycle === lifecycle), 0);

  return {
    workspace,
    counts: [
      { label: "Active", count: count("active") },
      { label: "Waiting", count: count("waiting") },
      { label: "Finished", count: count("finished") },
      { label: "Failed", count: count("failed") },
      { label: "Other", count: count("other") },
    ],
    agents,
  };
}

function lifecycleFor(agent: ObservatoryAgentSnapshot): AgentLifecycle {
  if (agent.attentionReason === "permission") return "waiting";

  switch (agent.status) {
    case "initializing":
    case "running":
      return "active";
    case "waiting":
    case "needs_input":
    case "permission":
      return "waiting";
    case "idle":
    case "closed":
      return "finished";
    case "error":
    case "failed":
      return "failed";
    default:
      return "other";
  }
}
