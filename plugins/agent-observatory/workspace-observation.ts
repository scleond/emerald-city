import type {
  PaseoAgent,
  PaseoApi,
  PaseoWorkspace,
} from "@getpaseo/client";
import {
  createWorkspaceObservation,
  type ObservatoryAgentSnapshot,
  type ObservatoryViewModel,
  type ObservatoryWorkspace,
} from "./observation";

export type ObservatoryPaseoApi = Pick<PaseoApi, "workspaces" | "agents">;

export type WorkspaceObservationState =
  | { phase: "loading" }
  | { phase: "ready"; view: ObservatoryViewModel }
  | { phase: "disconnected"; message: string }
  | { phase: "unavailable"; message: string };

interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const refreshIntervalMs = 15_000;

export class WorkspaceObservationController {
  private state: WorkspaceObservationState = { phase: "loading" };
  private readonly listeners = new Set<() => void>();
  private readonly agents = new Map<string, ObservatoryAgentSnapshot>();
  private workspace: ObservatoryWorkspace | null = null;
  private unsubscribeWorkspace: (() => void) | null = null;
  private unsubscribeAgent: (() => void) | null = null;
  private timer: unknown = null;
  private active = false;
  private refreshing = false;
  private directorySubscriptionsActive = false;

  constructor(
    private readonly paseo: ObservatoryPaseoApi,
    private readonly workspaceId: string,
    private readonly timers: TimerApi = {
      setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
      clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    },
  ) {}

  getSnapshot = (): WorkspaceObservationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.unsubscribeWorkspace = this.paseo.workspaces.subscribe((update) => {
      if (!this.active) return;
      if (update.kind === "upsert" && update.workspace.id === this.workspaceId) {
        this.workspace = toWorkspace(update.workspace);
        this.publishReady();
      } else if (update.kind === "remove" && update.id === this.workspaceId) {
        this.workspace = null;
        this.publish({
          phase: "unavailable",
          message: "The selected workspace is unavailable on this host.",
        });
      }
    });
    this.unsubscribeAgent = this.paseo.agents.subscribe((update) => {
      if (!this.active) return;
      if (update.kind === "upsert") {
        if (update.agent.workspaceId === this.workspaceId) {
          this.agents.set(update.agent.id, toAgent(update.agent));
        } else {
          this.agents.delete(update.agent.id);
        }
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

  private async refresh(subscribe: boolean): Promise<void> {
    if (this.refreshing || !this.active) return;
    this.refreshing = true;
    const shouldSubscribe = subscribe || !this.directorySubscriptionsActive;
    try {
      const [workspaces, agents] = await Promise.all([
        this.listAllWorkspaces(shouldSubscribe),
        this.listAllAgents(shouldSubscribe),
      ]);
      if (!this.active) return;
      this.directorySubscriptionsActive = true;
      this.workspace = workspaces.find((workspace) => workspace.id === this.workspaceId) ?? null;
      this.agents.clear();
      for (const agent of agents) {
        if (agent.workspaceId === this.workspaceId) this.agents.set(agent.id, agent);
      }
      if (!this.workspace) {
        this.publish({
          phase: "unavailable",
          message: "The selected workspace is unavailable on this host.",
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

  private async listAllWorkspaces(subscribe: boolean): Promise<ObservatoryWorkspace[]> {
    const entries: ObservatoryWorkspace[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.paseo.workspaces.list({
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
    if (!this.workspace) return;
    this.publish({
      phase: "ready",
      view: createWorkspaceObservation(this.workspace, [...this.agents.values()]),
    });
  }

  private publish(state: WorkspaceObservationState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function looksDisconnected(message: string): boolean {
  return /disconnect|offline|websocket|socket|connection (?:closed|lost|failed)/i.test(message);
}

function toWorkspace(workspace: PaseoWorkspace): ObservatoryWorkspace {
  return { id: workspace.id, name: workspace.name };
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
  };
}
