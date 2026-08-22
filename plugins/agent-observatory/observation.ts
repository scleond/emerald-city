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

export interface ObservatoryUsageFields {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
}

export type AgentUsageEvent =
  | { kind: "provisional"; turnId?: string; model?: string | null; usage?: ObservatoryUsageFields }
  | { kind: "final"; turnId?: string; model?: string | null; usage?: ObservatoryUsageFields };

export interface ObservatoryAgentUsageTurn {
  turnId: string | null;
  model: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  contextUsedTokens: number | null;
  contextMaxTokens: number | null;
  provisional: boolean;
}

export interface AgentUsageRecord {
  finalizedTurns: ObservatoryAgentUsageTurn[];
  provisionalTurn: ObservatoryAgentUsageTurn | null;
}

export function emptyAgentUsage(): AgentUsageRecord {
  return { finalizedTurns: [], provisionalTurn: null };
}

function toUsageTurn(
  event: AgentUsageEvent,
  fallbackModel: string | null,
): ObservatoryAgentUsageTurn {
  const usage = event.usage ?? {};
  return {
    turnId: event.turnId ?? null,
    model: event.model ?? fallbackModel,
    inputTokens: usage.inputTokens ?? null,
    cachedInputTokens: usage.cachedInputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    costUsd: usage.totalCostUsd ?? null,
    contextUsedTokens: usage.contextWindowUsedTokens ?? null,
    contextMaxTokens: usage.contextWindowMaxTokens ?? null,
    provisional: event.kind === "provisional",
  };
}

export function reduceAgentUsage(
  record: AgentUsageRecord,
  event: AgentUsageEvent,
  agentModel: string | null = null,
): AgentUsageRecord {
  if (event.kind === "provisional") {
    return { ...record, provisionalTurn: toUsageTurn(event, agentModel) };
  }
  const finalized = record.finalizedTurns.filter(
    (turn) => !event.turnId || turn.turnId !== event.turnId,
  );
  finalized.push(toUsageTurn(event, agentModel));
  return {
    finalizedTurns: finalized,
    provisionalTurn:
      !event.turnId || record.provisionalTurn?.turnId === event.turnId
        ? null
        : record.provisionalTurn,
  };
}

export function agentUsageTurns(record: AgentUsageRecord): ObservatoryAgentUsageTurn[] {
  return record.provisionalTurn
    ? [...record.finalizedTurns, record.provisionalTurn]
    : [...record.finalizedTurns];
}

export interface ModelUsageBar {
  model: string;
  freshInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function aggregateModelUsage(
  agents: readonly {
    model: string | null;
    usage: AgentUsageRecord;
  }[],
): ModelUsageBar[] {
  const byModel = new Map<string, ModelUsageBar>();
  for (const agent of agents) {
    for (const turn of agent.usage.finalizedTurns) {
      const model = turn.model ?? agent.model ?? "unknown";
      const bar = byModel.get(model) ?? {
        model,
        freshInputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      const input = turn.inputTokens ?? 0;
      const cached = Math.min(turn.cachedInputTokens ?? 0, input);
      const output = turn.outputTokens ?? 0;
      bar.freshInputTokens += Math.max(0, input - cached);
      bar.cachedInputTokens += cached;
      bar.outputTokens += output;
      bar.totalTokens += input + output;
      byModel.set(model, bar);
    }
  }
  return [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
}

export interface ObservatoryAgentSnapshot {
  id: string;
  workspaceId: string;
  title: string | null;
  status: string;
  updatedAt: string;
  requiresAttention: boolean;
  attentionReason: string | null;
  model: string | null;
  usage?: AgentUsageRecord;
}

export interface ObservatoryAgentView {
  id: string;
  workspaceId: string;
  title: string;
  status: string;
  lifecycle: AgentLifecycle;
  updatedAt: string;
  model: string | null;
  usageTurns: ObservatoryAgentUsageTurn[];
  switchedModels: boolean;
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
  models: ModelUsageBar[];
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
      model: snapshot.model,
      usageTurns: agentUsageTurns(snapshot.usage ?? emptyAgentUsage()),
      switchedModels: false,
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
  for (const agent of agents) {
    agent.switchedModels =
      new Set(
        agent.usageTurns.filter((turn) => !turn.provisional).map((turn) => turn.model ?? agent.model),
      ).size > 1;
  }

  return {
    project,
    counts: [
      { label: "Active", count: count("active") },
      { label: "Waiting", count: count("waiting") },
      { label: "Finished", count: count("finished") },
      { label: "Failed", count: count("failed") },
      { label: "Other", count: count("other") },
    ],
    models: aggregateModelUsage(
      agents.map((agent) => ({
        model: agent.model,
        usage: { finalizedTurns: agent.usageTurns, provisionalTurn: null },
      })),
    ),
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
