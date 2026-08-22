import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import {
  createProjectObservation,
  type ObservatoryAgentSnapshot,
  type ObservatoryProject,
  type ObservatoryViewModel,
  type ObservatoryWorkspaceSnapshot,
} from "./observation";
import { normalizeTimelineEntry, type NormalizedTimelineEntry, type RawTimelineEntry } from "./observation";

export type ObservatoryPaseoApi = Pick<PaseoApi, "workspaces" | "agents">;

export type ProjectObservationState =
  | { phase: "loading" }
  | { phase: "ready"; view: ObservatoryViewModel; timeline?: Record<string, TimelineState> }
  | { phase: "disconnected"; message: string }
  | { phase: "unavailable"; message: string };

interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const refreshIntervalMs = 15_000;
export interface TimelineState { entries: NormalizedTimelineEntry[]; cursor?: { epoch: string; seq: number }; hasOlder: boolean; loading: boolean; error?: string }

export class ProjectObservationController {
  private state: ProjectObservationState = { phase: "loading" };
  private readonly listeners = new Set<() => void>();
  private readonly workspaces = new Map<string, ObservatoryWorkspaceSnapshot>();
  private readonly agents = new Map<string, ObservatoryAgentSnapshot>();
  private project: ObservatoryProject | null = null;
  private unsubscribeWorkspace: (() => void) | null = null;
  private unsubscribeAgent: (() => void) | null = null;
  private timer: unknown = null;
  private active = false;
  private refreshing = false;
  private directorySubscriptionsActive = false;
  private readonly timelines = new Map<string, TimelineState>();

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
        this.agents.set(update.agent.id, toAgent(update.agent));
      } else if (update.kind === "upsert") {
        this.agents.delete(update.agent.id);
      } else {
        this.agents.delete(update.agentId);
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
    this.directorySubscriptionsActive = false;
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
  }

  async loadTimeline(agentId: string, older = false): Promise<void> {
    const current = this.timelines.get(agentId) ?? { entries: [], hasOlder: true, loading: false };
    if (current.loading || (older && !current.hasOlder)) return;
    this.timelines.set(agentId, { ...current, loading: true, error: undefined }); this.publishReady();
    try {
      const ref = this.paseo.agents.ref(agentId) as unknown as { timeline: { refetch(input: unknown): Promise<{ entries?: RawTimelineEntry[]; pageInfo?: { cursor?: { epoch: string; seq: number }; hasOlder?: boolean } }> } };
      const page = await ref.timeline.refetch({ limit: 50, ...(older && current.cursor ? { cursor: current.cursor } : {}), direction: "backward" });
      const entries = (page.entries ?? []).map(normalizeTimelineEntry);
      this.timelines.set(agentId, { entries: older ? [...current.entries, ...entries].slice(-50) : entries.slice(0, 50), cursor: page.pageInfo?.cursor, hasOlder: page.pageInfo?.hasOlder ?? false, loading: false });
    } catch (error) { this.timelines.set(agentId, { ...current, loading: false, error: error instanceof Error ? error.message : String(error) }); }
    this.publishReady();
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
      if (agent.workspaceId === workspaceId) this.agents.delete(agentId);
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
        if (this.workspaces.has(agent.workspaceId)) this.agents.set(agent.id, agent);
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

  private publishReady(): void {
    if (!this.project || this.workspaces.size === 0) return;
    this.publish({
      phase: "ready",
      view: createProjectObservation(
        this.project,
        [...this.workspaces.values()],
        [...this.agents.values()],
      ),
      timeline: Object.fromEntries(this.timelines),
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
    labels: agent.labels,
  };
}
