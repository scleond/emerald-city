import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import {
  createProjectObservation,
  emptyAgentUsage,
  reduceAgentUsage,
  type AgentUsageEvent,
  type AgentUsageRecord,
  type ObservatoryAgentSnapshot,
  type ObservatoryProject,
  type ObservatoryViewModel,
  type ObservatoryWorkspaceSnapshot,
  type ObservatoryUsageFields,
} from "./observation";

export interface ObservatoryAgentStreamEvent {
  type: string;
  turnId?: string;
  usage?: ObservatoryUsageFields;
  runtimeInfo?: { model?: string | null } | null;
}

export interface ObservatoryAgentStreamPayload {
  agentId: string;
  event: ObservatoryAgentStreamEvent;
}

export interface ObservatoryAgentTimelineHandle {
  subscribe(handler: (payload: ObservatoryAgentStreamPayload) => void): () => void;
}

export type ObservatoryPaseoApi = Pick<PaseoApi, "workspaces" | "agents"> & {
  agents: Pick<PaseoApi["agents"], "list" | "subscribe"> & {
    ref(agentId: string): { timeline: ObservatoryAgentTimelineHandle };
  };
};

export type ProjectObservationState =
  | { phase: "loading" }
  | { phase: "ready"; view: ObservatoryViewModel }
  | { phase: "disconnected"; message: string }
  | { phase: "unavailable"; message: string };

interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const refreshIntervalMs = 15_000;

export class ProjectObservationController {
  private state: ProjectObservationState = { phase: "loading" };
  private readonly listeners = new Set<() => void>();
  private readonly workspaces = new Map<string, ObservatoryWorkspaceSnapshot>();
  private readonly agents = new Map<string, ObservatoryAgentSnapshot>();
  private readonly usage = new Map<string, AgentUsageRecord>();
  private readonly agentModels = new Map<string, string | null>();
  private readonly streams = new Map<string, () => void>();
  private project: ObservatoryProject | null = null;
  private unsubscribeWorkspace: (() => void) | null = null;
  private unsubscribeAgent: (() => void) | null = null;
  private timer: unknown = null;
  private active = false;
  private refreshing = false;
  private directorySubscriptionsActive = false;

  constructor(
    private readonly paseo: ObservatoryPaseoApi,
    private readonly openingWorkspaceId: string,
    private readonly timers: TimerApi = {
      setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
      clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    },
  ) {}

  getSnapshot = (): ProjectObservationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.unsubscribeWorkspace = this.paseo.workspaces.subscribe((update) => {
      if (!this.active) return;
      if (update.kind === "upsert") {
        this.receiveWorkspace(toWorkspace(update.workspace), toProject(update.workspace));
      } else {
        this.removeWorkspace(update.id);
      }
    });
    this.unsubscribeAgent = this.paseo.agents.subscribe((update) => {
      if (!this.active) return;
      if (update.kind === "upsert" && this.workspaces.has(update.agent.workspaceId ?? "")) {
        this.trackAgent(update.agent.id, toAgent(update.agent));
      } else if (update.kind === "upsert") {
        this.removeAgent(update.agent.id);
      } else {
        this.removeAgent(update.agentId);
      }
      this.publishReady();
    });

    await this.refresh(true);
    if (!this.active) return;
    this.timer = this.timers.setInterval(() => void this.refresh(false), refreshIntervalMs);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribeWorkspace?.();
    this.unsubscribeAgent?.();
    this.unsubscribeWorkspace = null;
    this.unsubscribeAgent = null;
    for (const unsubscribe of this.streams.values()) unsubscribe();
    this.streams.clear();
    this.usage.clear();
    this.agentModels.clear();
    this.directorySubscriptionsActive = false;
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private receiveWorkspace(
    workspace: ObservatoryWorkspaceSnapshot,
    project: ObservatoryProject,
  ): void {
    if (!this.project && workspace.id === this.openingWorkspaceId) this.project = project;
    if (!this.project || workspace.projectId !== this.project.id || workspace.archivingAt !== null) {
      this.removeWorkspace(workspace.id);
      return;
    }
    this.project = project;
    this.workspaces.set(workspace.id, workspace);
    this.publishReady();
  }

  private removeWorkspace(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    for (const [agentId, agent] of this.agents) {
      if (agent.workspaceId === workspaceId) this.removeAgent(agentId);
    }
    if (this.workspaces.size === 0 && this.project) {
      this.publish({
        phase: "unavailable",
        message: "This project has no active workspaces on the selected host.",
      });
    } else {
      this.publishReady();
    }
  }

  private async refresh(subscribe: boolean): Promise<void> {
    if (this.refreshing || !this.active) return;
    this.refreshing = true;
    const shouldSubscribe = subscribe || !this.directorySubscriptionsActive;
    try {
      if (!this.project) {
        const openingWorkspace = await this.paseo.workspaces
          .ref(this.openingWorkspaceId)
          .refresh();
        if (!openingWorkspace || openingWorkspace.archivingAt != null) {
          this.publish({
            phase: "unavailable",
            message: "The opening workspace is unavailable on this host.",
          });
          return;
        }
        this.project = toProject(openingWorkspace);
      }

      const [workspaces, agents] = await Promise.all([
        this.listProjectWorkspaces(this.project.id, shouldSubscribe),
        this.listAllAgents(shouldSubscribe),
      ]);
      if (!this.active) return;
      this.directorySubscriptionsActive = true;
      this.workspaces.clear();
      for (const workspace of workspaces) {
        if (workspace.archivingAt === null) this.workspaces.set(workspace.id, workspace);
      }
      this.agents.clear();
      for (const agent of agents) {
        if (this.workspaces.has(agent.workspaceId)) this.trackAgent(agent.id, agent);
      }
      const tracked = new Set(this.agents.keys());
      for (const id of [...this.usage.keys(), ...this.agentModels.keys()]) {
        if (!tracked.has(id)) {
          this.usage.delete(id);
          this.agentModels.delete(id);
        }
      }
      for (const [id, unsubscribe] of this.streams) {
        if (!tracked.has(id)) {
          unsubscribe();
          this.streams.delete(id);
        }
      }
      if (this.workspaces.size === 0) {
        this.publish({
          phase: "unavailable",
          message: "This project has no active workspaces on the selected host.",
        });
      } else {
        this.publishReady();
      }
    } catch (error) {
      if (!this.active) return;
      this.directorySubscriptionsActive = false;
      const message = error instanceof Error ? error.message : String(error);
      this.publish(
        looksDisconnected(message)
          ? { phase: "disconnected", message: "The selected Paseo host is disconnected." }
          : { phase: "unavailable", message: `Observatory data is unavailable: ${message}` },
      );
    } finally {
      this.refreshing = false;
    }
  }

  private async listProjectWorkspaces(
    projectId: string,
    subscribe: boolean,
  ): Promise<ObservatoryWorkspaceSnapshot[]> {
    const entries: ObservatoryWorkspaceSnapshot[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.paseo.workspaces.list({
        filter: { projectId },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        ...(subscribe && !cursor ? { subscribe: {} } : {}),
      });
      entries.push(...page.entries.map(toWorkspace));
      cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    } while (cursor);
    return entries;
  }

  private async listAllAgents(subscribe: boolean): Promise<ObservatoryAgentSnapshot[]> {
    const entries: ObservatoryAgentSnapshot[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.paseo.agents.list({
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        ...(subscribe && !cursor ? { subscribe: {} } : {}),
      });
      entries.push(...page.entries.map(({ agent }) => toAgent(agent)));
      cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
    } while (cursor);
    return entries;
  }

  private trackAgent(agentId: string, agent: ObservatoryAgentSnapshot): void {
    this.agents.set(agentId, agent);
    if (!this.agentModels.has(agentId)) {
      this.agentModels.set(agentId, agent.model);
      this.usage.set(agentId, emptyAgentUsage());
    }
    this.subscribeAgentStream(agentId);
  }

  private removeAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.usage.delete(agentId);
    this.agentModels.delete(agentId);
    const unsubscribe = this.streams.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.streams.delete(agentId);
    }
  }

  private subscribeAgentStream(agentId: string): void {
    if (this.streams.has(agentId)) return;
    try {
      const unsubscribe = this.paseo.agents
        .ref(agentId)
        .timeline.subscribe((payload) => this.receiveAgentStream(payload));
      this.streams.set(agentId, unsubscribe);
    } catch {
      // Stream subscriptions are best-effort; usage stays empty until events arrive.
    }
  }

  private receiveAgentStream(payload: ObservatoryAgentStreamPayload): void {
    if (!this.active || !this.agents.has(payload.agentId)) return;
    const event = payload.event;
    const model = this.agentModels.get(payload.agentId) ?? null;
    const usageEvent = toUsageEvent(event);
    if (event.type === "model_changed") {
      const nextModel = event.runtimeInfo?.model ?? null;
      if (nextModel !== null) this.agentModels.set(payload.agentId, nextModel);
      return;
    }
    if (!usageEvent) return;
    this.usage.set(
      payload.agentId,
      reduceAgentUsage(this.usage.get(payload.agentId) ?? emptyAgentUsage(), usageEvent, model),
    );
    this.publishReady();
  }

  private publishReady(): void {
    if (!this.project || this.workspaces.size === 0) return;
    this.publish({
      phase: "ready",
      view: createProjectObservation(
        this.project,
        [...this.workspaces.values()],
        [...this.agents.values()].map((agent) => ({
          ...agent,
          usage: this.usage.get(agent.id) ?? emptyAgentUsage(),
        })),
      ),
    });
  }

  private publish(state: ProjectObservationState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function looksDisconnected(message: string): boolean {
  return /disconnect|offline|websocket|socket|connection (?:closed|lost|failed)/i.test(message);
}

function toProject(workspace: PaseoWorkspace): ObservatoryProject {
  return { id: workspace.projectId, name: workspace.projectDisplayName };
}

function toWorkspace(workspace: PaseoWorkspace): ObservatoryWorkspaceSnapshot {
  return {
    id: workspace.id,
    projectId: workspace.projectId,
    name: workspace.name,
    archivingAt: workspace.archivingAt ?? null,
  };
}

function toAgent(agent: PaseoAgent): ObservatoryAgentSnapshot {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId ?? "",
    title: agent.title,
    status: agent.status,
    updatedAt: agent.updatedAt,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    model: agent.model ?? null,
  };
}

function toUsageEvent(event: ObservatoryAgentStreamEvent): AgentUsageEvent | null {
  if (event.type === "usage_updated") {
    return { kind: "provisional", turnId: event.turnId, usage: event.usage };
  }
  if (event.type === "turn_completed") {
    return { kind: "final", turnId: event.turnId, usage: event.usage };
  }
  return null;
}
