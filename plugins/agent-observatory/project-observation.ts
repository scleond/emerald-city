import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import {
  createProjectObservation,
  deriveAttentionQueue,
  type AttentionEntry,
  emptyAgentUsage,
  reduceAgentUsage,
  normalizeUsageEvent,
  hasUsableUsage,
  fallbackUsageIdentity,
  usageIdentity,
  type AgentUsageEvent,
  type AgentUsageRecord,
  type ObservatoryAgentSnapshot,
  type ObservatoryProject,
  type ObservatoryViewModel,
  type ObservatoryWorkspaceSnapshot,
  type ObservatoryUsageFields,
} from "./observation";
import { normalizeTimelineEntry, TIMELINE_DETAIL_LIMIT, TIMELINE_SUMMARY_LIMIT, type AgentLifecycle, type NormalizedTimelineEntry, type RawTimelineEntry } from "./observation";
import type { AttentionDismissalRecord } from "./dismissals";
import { projectHistoricalUsage, type HistoricalUsageProjection, type NormalizedUsageTurn, type UsageRange, type UsageTurnStore } from "./usage-turns";

export interface ObservatoryDismissalApi {
  get(projectId: string): Promise<readonly AttentionDismissalRecord[]>;
  put(projectId: string, dismissal: AttentionDismissalRecord): Promise<readonly AttentionDismissalRecord[]>;
  removeAgents(projectId: string, agentIds: readonly string[]): Promise<readonly AttentionDismissalRecord[]>;
}

export interface ObservatoryAgentStreamEvent {
  type: string;
  timestamp?: string;
  turnId?: string;
  usage?: ObservatoryUsageFields;
  runtimeInfo?: { model?: string | null } | null;
}

export interface ObservatoryAgentStreamPayload {
  agentId: string;
  event: ObservatoryAgentStreamEvent;
}

export interface ObservatoryAgentStreamHandle {
  subscribe(handler: (payload: ObservatoryAgentStreamPayload) => void): () => void;
}
export interface TimelineRef extends ObservatoryAgentStreamHandle { refetch(input?: { limit?: number; cursor?: { epoch: string; seq: number }; direction?: string }): Promise<{ entries?: RawTimelineEntry[]; pageInfo?: { cursor?: { epoch: string; seq: number }; hasOlder?: boolean } }> }
export type ObservatoryPaseoApi = Omit<Pick<PaseoApi, "workspaces" | "agents">, "agents"> & { agents: Pick<PaseoApi["agents"], "list" | "subscribe"> & { ref(agentId: string): { timeline: TimelineRef } } };

export type ProjectObservationState =
  | { phase: "loading" }
  | { phase: "ready"; view: ObservatoryViewModel; attention: AttentionEntry[]; timeline?: Record<string, TimelineState>; historicalUsage?: Record<UsageRange, HistoricalUsageProjection>; dismissalError?: string; telemetry?: TelemetryDiagnostic }
  | { phase: "disconnected"; message: string }
  | { phase: "unavailable"; message: string };

interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

const refreshIntervalMs = 15_000;
export interface TimelineState { entries: NormalizedTimelineEntry[]; cursor?: { epoch: string; seq: number }; hasOlder: boolean; loading: boolean; error?: string }
export type TelemetryHealth = "reported" | "pending" | "not-reported";
export interface TelemetryDiagnostic { type: string; turnId: string | null; usagePresent: boolean; usageFields: string[]; eventFields: string[]; health: TelemetryHealth; lastSuccessAt: number | null; stale: boolean }

const maxTimelineRetries = 3;
const telemetryStaleAfterMs = 60_000;

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
  private readonly timelines = new Map<string, TimelineState>();
  private query = "";
  private lifecycles: AgentLifecycle[] = [];
  private dismissals: AttentionDismissalRecord[] = [];
  private dismissalError?: string;
  private readonly dismissalApi?: ObservatoryDismissalApi;
  private readonly usageStore?: UsageTurnStore;
  private readonly historicalTurns = new Map<string, readonly NormalizedUsageTurn[]>();
  private telemetry?: TelemetryDiagnostic;
  private telemetryLastSuccessAt: number | null = null;
  private readonly timelineRetries = new Map<string, number>();
  private refreshRetries = 0;
  private nextRefreshAt = 0;
  private readonly anonymousPersistenceIds = new Map<string, Map<string, string[]>>();
  private readonly anonymousPredecessors = new Map<string, { model: string; identity: string; key: string; at: number; tokens: number }>();

  constructor(
    private readonly paseo: ObservatoryPaseoApi,
    private readonly openingWorkspaceId: string,
    private readonly timers: TimerApi = {
      setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
      clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
    },
    private readonly now: () => number = () => Date.now(),
    dismissalApi?: ObservatoryDismissalApi,
    usageStore?: UsageTurnStore,
  ) {
    this.dismissalApi = dismissalApi;
    this.usageStore = usageStore;
  }

  getSnapshot = (): ProjectObservationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  setFilters(query: string, lifecycles: AgentLifecycle[] = []): void { this.query = query; this.lifecycles = lifecycles; this.publishReady(); }

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
        this.removeAgent(update.agent.id, false);
      } else {
        this.removeAgent(update.agentId, true);
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
    this.historicalTurns.clear();
    this.agentModels.clear();
    this.anonymousPersistenceIds.clear();
    this.anonymousPredecessors.clear();
    this.timelineRetries.clear();
    this.refreshRetries = 0;
    this.nextRefreshAt = 0;
    this.telemetry = undefined;
    this.telemetryLastSuccessAt = null;
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
      const page = await this.paseo.agents.ref(agentId).timeline.refetch({ limit: TIMELINE_DETAIL_LIMIT, ...(older && current.cursor ? { cursor: current.cursor, direction: "before" } : { direction: "tail" }) });
      this.ingestTimelineUsage(agentId, page.entries ?? []);
      const entries = (page.entries ?? []).map(normalizeTimelineEntry);
      this.timelines.set(agentId, { entries: older ? [...current.entries, ...entries] : entries.slice(0, 50), cursor: page.pageInfo?.cursor, hasOlder: page.pageInfo?.hasOlder ?? false, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.timelines.set(agentId, { ...current, loading: false, error: message });
    }
    this.publishReady();
  }
  async loadTimelineSummary(agentId: string): Promise<void> {
    try {
      const page = await this.paseo.agents.ref(agentId).timeline.refetch({ limit: TIMELINE_SUMMARY_LIMIT, direction: "tail" });
      this.ingestTimelineUsage(agentId, page.entries ?? []);
      this.timelineRetries.delete(agentId);
      this.timelines.set(agentId, { entries: (page.entries ?? []).map(normalizeTimelineEntry), cursor: page.pageInfo?.cursor, hasOlder: page.pageInfo?.hasOlder ?? false, loading: false });
      this.publishReady();
    } catch (error) {
      const current = this.timelines.get(agentId) ?? { entries: [], hasOlder: false, loading: false };
      const message = error instanceof Error ? error.message : String(error);
      const retries = this.timelineRetries.get(agentId) ?? 0;
      this.timelineRetries.set(agentId, looksDisconnected(message) ? Math.min(maxTimelineRetries, retries + 1) : maxTimelineRetries);
      this.timelines.set(agentId, { ...current, loading: false, error: message });
      this.publishReady();
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
      if (agent.workspaceId === workspaceId) this.removeAgent(agentId, false);
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
    if (!subscribe && this.now() < this.nextRefreshAt) return;
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
      this.refreshRetries = 0;
      this.nextRefreshAt = 0;
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
      try {
        await this.syncDismissals();
      } catch {
        // syncDismissals handles its own error state; keep ready phase
      }
      for (const agent of this.agents.values()) {
        const retries = this.timelineRetries.get(agent.id) ?? 0;
        if (retries < maxTimelineRetries) void this.loadTimelineSummary(agent.id);
      }
      await Promise.all([...this.agents.values()].map((agent) => this.restoreUsage(agent.id)));
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
      if (looksDisconnected(message)) {
        this.refreshRetries = Math.min(maxTimelineRetries, this.refreshRetries + 1);
        this.nextRefreshAt = this.now() + Math.min(8_000, 1_000 * (2 ** (this.refreshRetries - 1)));
        if (this.project && this.workspaces.size > 0) this.publishReady();
        else this.publish({ phase: "disconnected", message: "The selected Paseo host is disconnected." });
      } else {
        this.publish({ phase: "unavailable", message: `Observatory data is unavailable: ${message}` });
      }
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
      this.agentModels.set(agentId, agent.model ?? null);
      this.usage.set(agentId, emptyAgentUsage());
    }
    this.subscribeAgentStream(agentId);
  }

  private async restoreUsage(agentId: string): Promise<void> {
    if (!this.usageStore || !this.project) return;
    const agent = this.agents.get(agentId);
    if (!agent) return;
    try {
      const turns = await this.usageStore.get({ projectId: this.project.id, workspaceId: agent.workspaceId, agentId });
      this.historicalTurns.set(agentId, turns);
      let record = emptyAgentUsage();
      for (const turn of turns) {
        record = reduceAgentUsage(record, { kind: turn.confidence === "low" ? "provisional" : "final", turnId: turn.turnId, model: turn.model, usage: { inputTokens: turn.inputTokens ?? undefined, cachedInputTokens: turn.cachedInputTokens ?? undefined, outputTokens: turn.outputTokens ?? undefined, totalCostUsd: turn.costUsd ?? undefined, contextWindowUsedTokens: turn.contextUsedTokens ?? undefined, contextWindowMaxTokens: turn.contextMaxTokens ?? undefined } }, this.agentModels.get(agentId) ?? null);
      }
      this.usage.set(agentId, record);
    } catch { /* malformed persisted data must not prevent live ingestion */ }
  }

  private removeAgent(agentId: string, isExplicitRemoval = false): void {
    this.agents.delete(agentId);
    this.usage.delete(agentId);
    this.agentModels.delete(agentId);
    const unsubscribe = this.streams.get(agentId);
    if (unsubscribe) {
      unsubscribe();
      this.streams.delete(agentId);
    }
    if (isExplicitRemoval && this.dismissalApi && this.project) {
      void this.dismissalApi.removeAgents(this.project.id, [agentId]).catch(() => {});
    }
  }

  async syncDismissals(): Promise<void> {
    if (!this.project || !this.dismissalApi) return;
    try {
      this.dismissals = [...(await this.dismissalApi.get(this.project.id))];
      this.dismissalError = undefined;
    } catch (error) {
      this.dismissalError = error instanceof Error ? error.message : String(error);
    }
    this.publishReady();
  }

  async dismissAttention(entry: AttentionEntry): Promise<void> {
    if (!this.project || !this.dismissalApi) return;
    const record: AttentionDismissalRecord = {
      agentId: entry.agentId,
      episodeId: entry.episodeId,
      reason: entry.reason,
      workspaceId: entry.workspaceId,
      dismissedAt: new Date().toISOString(),
    };
    // Optimistic update
    this.dismissals = [...this.dismissals.filter((r) => !(r.agentId === record.agentId && r.episodeId === record.episodeId)), record];
    this.publishReady();
    try {
      const updated = await this.dismissalApi.put(this.project.id, record);
      this.dismissals = [...updated];
      this.dismissalError = undefined;
    } catch (error) {
      this.dismissalError = error instanceof Error ? error.message : String(error);
      await this.syncDismissals();
      return;
    } finally {
      this.publishReady();
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
    this.telemetry = {
      type: event.type,
      turnId: event.turnId ?? null,
      usagePresent: hasUsableUsage(event.usage),
      usageFields: event.usage ? Object.keys(event.usage).sort() : [],
      eventFields: Object.keys(event).filter((key) => key !== "usage").sort(),
      health: event.type === "turn_completed" && hasUsableUsage(event.usage) ? "reported" : event.type === "usage_updated" && hasUsableUsage(event.usage) ? "pending" : "not-reported",
      lastSuccessAt: this.telemetryLastSuccessAt,
      stale: this.telemetryLastSuccessAt === null || this.now() - this.telemetryLastSuccessAt >= telemetryStaleAfterMs,
    };
    if (hasUsableUsage(event.usage)) {
      this.telemetryLastSuccessAt = this.now();
      this.telemetry.lastSuccessAt = this.telemetryLastSuccessAt;
      this.telemetry.stale = false;
    }
    const model = this.agentModels.get(payload.agentId) ?? null;
    const usageEvent = normalizeUsageEvent(event);
    if (event.type === "model_changed") {
      const nextModel = event.runtimeInfo?.model ?? null;
      if (nextModel !== null) this.agentModels.set(payload.agentId, nextModel);
      return;
    }
    if (!usageEvent) {
      this.publishReady();
      return;
    }
    const persistenceId = this.persistenceIdentity(payload.agentId, usageEvent, model);
    this.usage.set(
      payload.agentId,
      reduceAgentUsage(this.usage.get(payload.agentId) ?? emptyAgentUsage(), usageEvent, model),
    );
    void this.persistUsage(payload.agentId, { ...usageEvent, observedAt: event.timestamp }, model, persistenceId);
    this.publishReady();
  }

  private ingestTimelineUsage(agentId: string, entries: readonly RawTimelineEntry[]): void {
    for (const entry of entries) {
      const item = entry.item && typeof entry.item === "object" ? entry.item as Record<string, unknown> : {};
      const type = String(item.type ?? item.kind ?? "");
      const usage = item.usage && typeof item.usage === "object" ? item.usage as ObservatoryUsageFields : undefined;
      if (!usage || !["usage_updated", "turn_completed"].includes(type)) continue;
      const event = normalizeUsageEvent({ type, turnId: item.turnId, model: item.model, usage, timestamp: entry.timestamp });
      if (!event) continue;
      const persistenceId = this.persistenceIdentity(agentId, event, event.model ?? this.agentModels.get(agentId) ?? null);
      this.usage.set(agentId, reduceAgentUsage(this.usage.get(agentId) ?? emptyAgentUsage(), event, this.agentModels.get(agentId) ?? null));
      void this.persistUsage(agentId, event, event.model ?? this.agentModels.get(agentId) ?? null, persistenceId, entry.timestamp);
    }
  }

  private persistenceIdentity(agentId: string, event: AgentUsageEvent, model: string | null): string | undefined {
    if (event.turnId) return undefined;
    let identities = this.anonymousPersistenceIds.get(agentId);
    if (!identities) { identities = new Map(); this.anonymousPersistenceIds.set(agentId, identities); }
    if (event.kind === "provisional") {
      const key = fallbackUsageIdentity(event.model ?? model, event.usage);
      const queue = identities.get(key) ?? [];
      const modelName = event.model ?? model ?? "unknown";
      const at = event.observedAt ? Date.parse(event.observedAt) : NaN;
      const tokens = (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0);
      const predecessor = this.anonymousPredecessors.get(agentId);
      if (predecessor && predecessor.model === modelName && Number.isFinite(at) && predecessor.at < at && tokens > predecessor.tokens) {
        const oldQueue = identities.get(predecessor.key);
        oldQueue?.splice(oldQueue.indexOf(predecessor.identity), 1);
        if (oldQueue?.length === 0) identities.delete(predecessor.key);
        queue.push(predecessor.identity);
        identities.set(key, queue);
        this.anonymousPredecessors.set(agentId, { model: modelName, identity: predecessor.identity, key, at, tokens });
        return predecessor.identity;
      }
      const identity = queue.find((candidate) => candidate.endsWith(`:${event.observedAt ?? ""}`)) ?? `${key}:${event.observedAt ?? ""}`;
      if (queue.includes(identity)) return identity;
      queue.push(identity);
      identities.set(key, queue);
      this.anonymousPredecessors.set(agentId, { model: modelName, identity, key, at, tokens });
      return identity;
    }
    const key = fallbackUsageIdentity(event.model ?? model, event.usage);
    const matching = identities.get(key);
    const identity = matching?.shift();
    if (matching && matching.length === 0) identities.delete(key);
    return identity ?? `final:${fallbackUsageIdentity(event.model ?? model, event.usage)}`;
  }

  private async persistUsage(agentId: string, event: AgentUsageEvent, fallbackModel: string | null, persistenceId?: string, observedAt = new Date(this.now()).toISOString()): Promise<void> {
    if (!this.usageStore || !this.project) return;
    const agent = this.agents.get(agentId);
    if (!agent || !event.usage) return;
    const usage = event.usage;
    const turn: NormalizedUsageTurn = {
      projectId: this.project.id, workspaceId: agent.workspaceId, agentId,
      turnId: event.turnId ?? persistenceId ?? fallbackUsageIdentity(event.model ?? fallbackModel, usage),
      observedAt, startedAt: null, completedAt: event.kind === "final" ? observedAt : null,
      model: event.model ?? fallbackModel, inputTokens: usage.inputTokens ?? null, cachedInputTokens: usage.cachedInputTokens ?? null,
      outputTokens: usage.outputTokens ?? null, contextUsedTokens: usage.contextWindowUsedTokens ?? null, contextMaxTokens: usage.contextWindowMaxTokens ?? null,
      costUsd: usage.totalCostUsd ?? null, costState: usage.totalCostUsd === undefined ? "unknown" : "complete", confidence: event.kind === "final" ? "high" : "low",
    };
    try { await this.usageStore.put(turn); } catch { /* invalid records are ignored */ }
  }

  private publishReady(): void {
    if (!this.project || this.workspaces.size === 0) return;
    if (this.telemetry) {
      this.telemetry.stale = this.telemetryLastSuccessAt === null || this.now() - this.telemetryLastSuccessAt >= telemetryStaleAfterMs;
    }
    const dismissedSet = new Set(this.dismissals.map((r) => r.episodeId));
    this.publish({
      phase: "ready",
      view: createProjectObservation(
        this.project,
        [...this.workspaces.values()],
        [...this.agents.values()].map((agent) => ({
          ...agent,
          usage: this.usage.get(agent.id) ?? emptyAgentUsage(),
        })),
        { query: this.query, lifecycles: this.lifecycles },
      ),
      attention: deriveAttentionQueue({
        project: this.project,
        workspaces: [...this.workspaces.values()],
        agents: [...this.agents.values()].map((agent) => ({
          agent,
          timeline: this.timelines.get(agent.id)?.entries,
        })),
        now: this.now(),
        dismissed: dismissedSet,
      }),
      timeline: Object.fromEntries(this.timelines),
      ...(this.dismissalError ? { dismissalError: this.dismissalError } : {}),
      ...(this.telemetry ? { telemetry: this.telemetry } : {}),
      historicalUsage: Object.fromEntries((["24h", "7d", "30d"] as UsageRange[]).map((range) => [range, projectHistoricalUsage([...this.historicalTurns.values()].flat(), range, this.now())])) as Record<UsageRange, HistoricalUsageProjection>,
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
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    requiresAttention: agent.requiresAttention ?? false,
    attentionReason: agent.attentionReason ?? null,
    attentionTimestamp: (agent as unknown as { attentionTimestamp?: string | null }).attentionTimestamp ?? null,
    pendingPermissions: (agent as unknown as { pendingPermissions?: unknown[] }).pendingPermissions?.length ?? 0,
    model: agent.model ?? null,
    labels: agent.labels,
  };
}





