export type AgentLifecycle = "active" | "waiting" | "finished" | "failed" | "other";

export interface ObservatoryProject {
  id: string;
  name: string;
}

export interface ObservatoryWorkspaceSnapshot {
  id: string;
  projectId: string;
  name: string;
  archivingAt: string | null;
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
  workspaceId: string;
  title: string;
  status: string;
  lifecycle: AgentLifecycle;
  updatedAt: string;
}

export interface ObservatoryWorkspaceView {
  id: string;
  name: string;
  agents: ObservatoryAgentView[];
}

export interface LifecycleCount {
  label: "Active" | "Waiting" | "Finished" | "Failed" | "Other";
  count: number;
}

export interface ObservatoryViewModel {
  project: ObservatoryProject;
  counts: LifecycleCount[];
  workspaces: ObservatoryWorkspaceView[];
}

const lifecycleOrder: AgentLifecycle[] = ["active", "waiting", "failed", "finished", "other"];

export function createProjectObservation(
  project: ObservatoryProject,
  workspaceSnapshots: readonly ObservatoryWorkspaceSnapshot[],
  agentSnapshots: readonly ObservatoryAgentSnapshot[],
): ObservatoryViewModel {
  const activeWorkspaces = workspaceSnapshots
    .filter((workspace) => workspace.projectId === project.id && workspace.archivingAt === null)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const workspaceIds = new Set(activeWorkspaces.map((workspace) => workspace.id));
  const agentsByWorkspace = new Map<string, ObservatoryAgentView[]>();

  for (const snapshot of agentSnapshots) {
    if (!workspaceIds.has(snapshot.workspaceId)) continue;
    const agents = agentsByWorkspace.get(snapshot.workspaceId) ?? [];
    agents.push({
      id: snapshot.id,
      workspaceId: snapshot.workspaceId,
      title: snapshot.title?.trim() || snapshot.id,
      status: snapshot.status,
      lifecycle: lifecycleFor(snapshot),
      updatedAt: snapshot.updatedAt,
    });
    agentsByWorkspace.set(snapshot.workspaceId, agents);
  }

  const workspaces = activeWorkspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    agents: (agentsByWorkspace.get(workspace.id) ?? []).sort(compareAgents),
  }));
  const agents = workspaces.flatMap((workspace) => workspace.agents);
  const count = (lifecycle: AgentLifecycle) =>
    agents.reduce((total, agent) => total + Number(agent.lifecycle === lifecycle), 0);

  return {
    project,
    counts: [
      { label: "Active", count: count("active") },
      { label: "Waiting", count: count("waiting") },
      { label: "Finished", count: count("finished") },
      { label: "Failed", count: count("failed") },
      { label: "Other", count: count("other") },
    ],
    workspaces,
  };
}

function compareAgents(left: ObservatoryAgentView, right: ObservatoryAgentView): number {
  const lifecycleDifference =
    lifecycleOrder.indexOf(left.lifecycle) - lifecycleOrder.indexOf(right.lifecycle);
  return lifecycleDifference || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
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
