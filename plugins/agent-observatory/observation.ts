export type AgentLifecycle = "active" | "waiting" | "finished" | "failed" | "other";

export interface ObservatoryProject { id: string; name: string }
export interface ObservatoryWorkspaceSnapshot { id: string; projectId: string; name: string; archivingAt: string | null }

export interface ObservatoryUsageFields {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
}

export type AgentUsageEvent =
  | { kind: "provisional"; turnId?: string; model?: string | null; usage?: ObservatoryUsageFields; observedAt?: string }
  | { kind: "final"; turnId?: string; model?: string | null; usage?: ObservatoryUsageFields; observedAt?: string };

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
  observedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface AgentUsageRecord {
  finalizedTurns: ObservatoryAgentUsageTurn[];
  provisionalTurn: ObservatoryAgentUsageTurn | null;
}

export function hasUsableUsage(usage: ObservatoryUsageFields | null | undefined): usage is ObservatoryUsageFields {
  return usage !== null && usage !== undefined && Object.values(usage).some((value) => typeof value === "number" && Number.isFinite(value));
}

export function normalizeUsageEvent(input: { type?: string; kind?: string; turnId?: unknown; model?: unknown; usage?: ObservatoryUsageFields | null; timestamp?: string; observedAt?: string }): AgentUsageEvent | null {
  const type = input.type ?? input.kind;
  if (type !== "usage_updated" && type !== "turn_completed") return null;
  if (!hasUsableUsage(input.usage)) return null;
  return { kind: type === "turn_completed" ? "final" : "provisional", turnId: typeof input.turnId === "string" ? input.turnId : undefined, model: typeof input.model === "string" ? input.model : undefined, usage: input.usage, observedAt: input.timestamp ?? input.observedAt };
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
    observedAt: event.observedAt ?? null,
    startedAt: event.observedAt ?? null,
    completedAt: event.kind === "final" ? event.observedAt ?? null : null,
  };
}

/** Lower-confidence identity for events without a provider turn ID; usage is part of the key. */
export function fallbackUsageIdentity(model: string | null | undefined, usage: ObservatoryUsageFields | null | undefined = undefined): string {
  const normalized = Object.entries(usage ?? {}).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).sort(([a], [b]) => a.localeCompare(b));
  return `fallback:${model ?? "unknown"}:${JSON.stringify(normalized)}`;
}

function fallbackTurnIdentity(turn: ObservatoryAgentUsageTurn): string {
  return fallbackUsageIdentity(turn.model, { inputTokens: turn.inputTokens ?? undefined, cachedInputTokens: turn.cachedInputTokens ?? undefined, outputTokens: turn.outputTokens ?? undefined, totalCostUsd: turn.costUsd ?? undefined, contextWindowUsedTokens: turn.contextUsedTokens ?? undefined, contextWindowMaxTokens: turn.contextMaxTokens ?? undefined });
}

function turnIdentity(turn: ObservatoryAgentUsageTurn): string {
  return turn.turnId ? `turn:${turn.turnId}` : fallbackTurnIdentity(turn);
}

export function reduceAgentUsage(
  record: AgentUsageRecord,
  event: AgentUsageEvent,
  agentModel: string | null = null,
): AgentUsageRecord {
  if (event.kind === "provisional") {
    return { ...record, provisionalTurn: toUsageTurn(event, agentModel) };
  }
  const next = toUsageTurn(event, agentModel);
  const identity = turnIdentity(next);
  const finalized = record.finalizedTurns.filter((turn) => turnIdentity(turn) !== identity);
  finalized.push(next);
  return {
    finalizedTurns: finalized,
    provisionalTurn:
      !event.turnId || record.provisionalTurn?.turnId === event.turnId || record.provisionalTurn?.turnId === null
        ? null
        : record.provisionalTurn,
  };
}

export function agentUsageTurns(record: AgentUsageRecord): ObservatoryAgentUsageTurn[] {
  return record.provisionalTurn
    ? [...record.finalizedTurns, record.provisionalTurn]
    : [...record.finalizedTurns];
}

export function finalizedTurnScale(turns: readonly ObservatoryAgentUsageTurn[]): number {
  return Math.max(...turns.filter((turn) => !turn.provisional).map((turn) => (turn.inputTokens ?? 0) + (turn.outputTokens ?? 0)), 1);
}

export function turnBarHeight(turn: ObservatoryAgentUsageTurn, scale: number): number {
  const total = Math.max((turn.inputTokens ?? 0) + (turn.outputTokens ?? 0), 1);
  return Math.min(120, Math.max(24, Math.round((total / Math.max(scale, 1)) * 120)));
}

export function selectedAgentAfterProjection(selectedAgentId: string | null, agents: readonly { id: string }[]): string | null {
  return selectedAgentId && agents.some((agent) => agent.id === selectedAgentId) ? selectedAgentId : null;
}

export interface ModelUsageBar {
  model: string;
  provider: string | null;
  freshInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reportedCostUsd: number | null;
  costState: CostState;
}

export type CostState = "complete" | "partial" | "unknown";
export interface UsageTotals {
  recordedTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  reportedCostUsd: number | null;
  costState: CostState;
}
export interface AgentUsageAggregate extends UsageTotals {
  agentId: string;
  finalizedTurnCount: number;
}
export interface DelegationTreeAgent extends ObservatoryAgentView { usage: AgentUsageAggregate; workspaceName: string }
export interface DashboardProjection extends UsageTotals {
  workingAgentCount: number;
  finalizedTurnCount: number;
  models: ModelUsageBar[];
  agents: DelegationTreeAgent[];
  liveTurns: { agentId: string; turn: ObservatoryAgentUsageTurn }[];
}

const providerMappings: Readonly<Record<string, string>> = {
  "claude-": "Anthropic",
  "gpt-": "OpenAI",
  "o1-": "OpenAI",
  "o3-": "OpenAI",
  "gemini-": "Google",
};

function providerFor(model: string): string | null {
  const prefix = Object.keys(providerMappings).find((candidate) => model.startsWith(candidate));
  return prefix ? providerMappings[prefix] : null;
}

function turnTotals(turns: readonly ObservatoryAgentUsageTurn[]): UsageTotals {
  let inputTokens = 0; let cachedInputTokens = 0; let outputTokens = 0;
  let knownCost = 0; let knownCosts = 0;
  for (const turn of turns) {
    const input = turn.inputTokens ?? 0;
    cachedInputTokens += Math.min(Math.max(0, turn.cachedInputTokens ?? 0), input);
    inputTokens += input;
    outputTokens += Math.max(0, turn.outputTokens ?? 0);
    if (turn.costUsd !== null) { knownCost += turn.costUsd; knownCosts++; }
  }
  const costState: CostState = knownCosts === 0 ? "unknown" : knownCosts === turns.length ? "complete" : "partial";
  return { recordedTokens: inputTokens + outputTokens, inputTokens, cachedInputTokens, freshInputTokens: Math.max(0, inputTokens - cachedInputTokens), outputTokens, reportedCostUsd: costState === "unknown" ? null : knownCost, costState };
}

export function projectDashboard(agents: readonly ObservatoryAgentView[], workspaces: readonly ObservatoryWorkspaceView[]): DashboardProjection {
  const finalized = agents.flatMap((agent) => agent.usageTurns.filter((turn) => !turn.provisional));
  const totals = turnTotals(finalized);
  const models = aggregateModelUsage(agents.map((agent) => ({ model: agent.model, usage: { finalizedTurns: agent.usageTurns.filter((turn) => !turn.provisional), provisionalTurn: null } })));
  const aggregates = agents.map((agent) => { const turns = agent.usageTurns.filter((turn) => !turn.provisional); return { ...agent, workspaceName: workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? "", usage: { ...turnTotals(turns), agentId: agent.id, finalizedTurnCount: turns.length } }; });
  return { ...totals, workingAgentCount: agents.filter((agent) => agent.lifecycle === "active" || agent.lifecycle === "waiting").length, finalizedTurnCount: finalized.length, models, agents: aggregates, liveTurns: agents.flatMap((agent) => agent.usageTurns.filter((turn) => turn.provisional).map((turn) => ({ agentId: agent.id, turn }))) };
}

export function aggregateModelUsage(
  agents: readonly {
    model: string | null;
    usage: AgentUsageRecord;
  }[],
): ModelUsageBar[] {
  const byModel = new Map<string, ModelUsageBar>();
  const costCounts = new Map<string, { known: number; total: number }>();
  for (const agent of agents) {
    for (const turn of agent.usage.finalizedTurns) {
      const model = turn.model ?? agent.model ?? "unknown";
      const bar = byModel.get(model) ?? {
        model,
        provider: providerFor(model),
        freshInputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reportedCostUsd: null,
        costState: "unknown",
      };
      const input = turn.inputTokens ?? 0;
      const cached = Math.min(Math.max(0, turn.cachedInputTokens ?? 0), Math.max(0, input));
      const output = turn.outputTokens ?? 0;
      bar.freshInputTokens += Math.max(0, input - cached);
      bar.cachedInputTokens += cached;
      bar.outputTokens += output;
      bar.totalTokens += input + output;
      if (turn.costUsd !== null) bar.reportedCostUsd = (bar.reportedCostUsd ?? 0) + turn.costUsd;
      const counts = costCounts.get(model) ?? { known: 0, total: 0 };
      counts.total++;
      if (turn.costUsd !== null) counts.known++;
      costCounts.set(model, counts);
      byModel.set(model, bar);
    }
  }
  return [...byModel.values()].map((bar) => { const counts = costCounts.get(bar.model)!; const costState: CostState = counts.known === 0 ? "unknown" : counts.known === counts.total ? "complete" : "partial"; return { ...bar, costState }; }).sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model));
}

export interface ObservatoryAgentSnapshot {
  id: string; workspaceId: string; title: string | null; status: string; createdAt: string; updatedAt: string;
  requiresAttention: boolean; attentionReason: string | null; attentionTimestamp: string | null;
  pendingPermissions: number; labels?: Record<string, string>;
  model?: string | null; usage?: AgentUsageRecord;
}
export interface ObservatoryAgentView {
  id: string; workspaceId: string; title: string; status: string; lifecycle: AgentLifecycle; updatedAt: string;
  parentId: string | null; parentTitle: string | null; parentWorkspaceId: string | null; depth: number;
  model: string | null; usageTurns: ObservatoryAgentUsageTurn[]; switchedModels: boolean;
}
export interface ObservatoryWorkspaceView { id: string; name: string; agents: ObservatoryAgentView[] }
export interface LifecycleCount { label: "Active" | "Waiting" | "Finished" | "Failed" | "Other"; count: number }
export interface RawTimelineEntry { item?: unknown; timestamp?: string }
export type TimelineCategory = "message" | "tool_activity" | "status_change" | "permission_request" | "failure" | "completion" | "other";
export interface NormalizedTimelineEntry {
  category: TimelineCategory; label: string; summary: string; at: string;
  /** Counts as meaningful progress: resets the fixed 15-minute inactivity timer. */
  progress: boolean;
  /** Automatic heartbeat entry: resets inactivity only when it reports progress or a status change (see `progress`). */
  heartbeat?: boolean;
  /** Start of an observable long-running operation that pauses the inactivity timer until it finishes. */
  longRunning?: boolean;
}
export const TIMELINE_SUMMARY_LIMIT = 10;
export const TIMELINE_DETAIL_LIMIT = 50;
export interface ObservatoryViewModel { project: ObservatoryProject; counts: LifecycleCount[]; workspaces: ObservatoryWorkspaceView[]; models: ModelUsageBar[]; dashboard: DashboardProjection }
const parentLabel = "paseo.parent-agent-id";
const lifecycleOrder: AgentLifecycle[] = ["active", "waiting", "failed", "finished", "other"];

export function createProjectObservation(project: ObservatoryProject, workspaceSnapshots: readonly ObservatoryWorkspaceSnapshot[], agentSnapshots: readonly ObservatoryAgentSnapshot[], filters: { query?: string; lifecycles?: AgentLifecycle[] } = {}): ObservatoryViewModel {
  const active = workspaceSnapshots.filter(w => w.projectId === project.id && w.archivingAt === null).sort(compareWorkspace);
  const ids = new Set(active.map(w => w.id));
  const all = agentSnapshots.filter(a => ids.has(a.workspaceId)).map(toAgent);
  const counts = (["active", "waiting", "finished", "failed", "other"] as AgentLifecycle[]).map(lifecycle => ({ label: labelFor(lifecycle), count: all.filter(a => a.lifecycle === lifecycle).length }));
  const query = filters.query?.trim().toLocaleLowerCase();
  const allowed = filters.lifecycles?.length ? new Set(filters.lifecycles) : null;
  const kept = all.filter(a => (!allowed || allowed.has(a.lifecycle)) && (!query || a.title.toLocaleLowerCase().includes(query) || active.find(w => w.id === a.workspaceId)?.name.toLocaleLowerCase().includes(query)));
  const keptIds = new Set(kept.map(a => a.id));
  const byId = new Map(all.map(a => [a.id, a]));
  for (const agent of kept) {
    const parentId = agent.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && keptIds.has(parent.id) && parent.workspaceId === agent.workspaceId) { agent.parentTitle = parent.title; agent.parentWorkspaceId = parent.workspaceId; }
    else if (parent) { agent.parentTitle = parent.title; agent.parentWorkspaceId = parent.workspaceId; }
    else if (parentId) { agent.parentTitle = null; agent.parentWorkspaceId = null; }
     agent.depth = parent && keptIds.has(parent.id) && parent.workspaceId === agent.workspaceId ? (parent.depth + 1) : 0;
    agent.switchedModels =
      new Set(agent.usageTurns.filter((turn) => !turn.provisional).map((turn) => turn.model ?? agent.model)).size > 1;
  }
  // Build one tree across the project; workspace buckets retain workspace identity for rendering.
  const ordered = treeOrder(kept);
  const workspaces = active.map(w => ({ id: w.id, name: w.name, agents: ordered.filter((agent) => agent.workspaceId === w.id) }));
  const agents = ordered;
  return { project, counts, models: aggregateModelUsage(agents.map((agent) => ({ model: agent.model, usage: { finalizedTurns: agent.usageTurns, provisionalTurn: null } }))), dashboard: projectDashboard(agents, workspaces), workspaces };
}
function treeOrder(agents: ObservatoryAgentView[]): ObservatoryAgentView[] {
  const ids = new Set(agents.map((agent) => agent.id));
  const parentIds = new Map(agents.map((agent) => [agent.id, agent.parentId && ids.has(agent.parentId) ? agent.parentId : null]));
  const broken = new Set<string>();
  for (const agent of agents) {
    const path: string[] = []; const positions = new Map<string, number>(); let current: string | null = agent.id;
    while (current && !positions.has(current) && !broken.has(current)) {
      positions.set(current, path.length); path.push(current); current = parentIds.get(current) ?? null;
    }
    if (current && positions.has(current)) {
      broken.add([...path.slice(positions.get(current)!)].sort()[0]!);
    }
  }
  const children = new Map<string, ObservatoryAgentView[]>(); const roots: ObservatoryAgentView[] = [];
  for (const a of agents) { const p = broken.has(a.id) ? null : parentIds.get(a.id) ?? null; if (p) (children.get(p) ?? (children.set(p, []), children.get(p)!)).push(a); else roots.push(a); }
  const out: ObservatoryAgentView[] = []; const visit = (a: ObservatoryAgentView, depth: number) => { a.depth = depth; out.push(a); for (const child of (children.get(a.id) ?? []).sort(compareAgents)) visit(child, depth + 1); };
  for (const root of roots.sort(compareAgents)) visit(root, 0); return out;
}
function compareWorkspace(a: ObservatoryWorkspaceSnapshot, b: ObservatoryWorkspaceSnapshot) { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id) }
function compareAgents(a: ObservatoryAgentView, b: ObservatoryAgentView) { return lifecycleOrder.indexOf(a.lifecycle) - lifecycleOrder.indexOf(b.lifecycle) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id) }
function labelFor(l: AgentLifecycle): LifecycleCount["label"] { return l[0].toUpperCase() + l.slice(1) as LifecycleCount["label"] }
function lifecycleFor(a: ObservatoryAgentSnapshot): AgentLifecycle { if (a.attentionReason === "permission") return "waiting"; if (["initializing", "running"].includes(a.status)) return "active"; if (["waiting", "needs_input", "permission"].includes(a.status)) return "waiting"; if (["idle", "closed"].includes(a.status)) return "finished"; if (["error", "failed"].includes(a.status)) return "failed"; return "other" }
function toAgent(a: ObservatoryAgentSnapshot): ObservatoryAgentView { return { id: a.id, workspaceId: a.workspaceId, title: a.title?.trim() || a.id, status: a.status, lifecycle: lifecycleFor(a), updatedAt: a.updatedAt, parentId: a.labels?.[parentLabel] ?? null, parentTitle: null, parentWorkspaceId: null, depth: 0, model: a.model ?? null, usageTurns: agentUsageTurns(a.usage ?? emptyAgentUsage()), switchedModels: false } }

export function normalizeTimelineEntry(entry: RawTimelineEntry): NormalizedTimelineEntry {
  const item = entry.item && typeof entry.item === "object" ? entry.item as Record<string, unknown> : {};
  const type = String(item.type ?? item.kind ?? ""); const text = typeof item.text === "string" ? item.text : typeof item.summary === "string" ? item.summary : "";
  const summary = text.slice(0, 140); let category: TimelineCategory = "other"; let label = "Other activity";
  let progress = false; let heartbeat: boolean | undefined; let longRunning: boolean | undefined;
  if (type === "heartbeat") { category = "other"; label = "Heartbeat"; heartbeat = true; progress = item.progress === true || item.statusChange === true; }
  else {
    if (["user_message", "assistant_message", "reasoning"].includes(type)) { category = "message"; label = "Message"; progress = true; }
    else if (type === "tool_call") { category = item.status === "failed" ? "failure" : "tool_activity"; label = category === "failure" ? "Failure" : "Tool activity"; if (category === "tool_activity") { progress = true; longRunning = item.status === "running" || undefined; } }
    else if (type === "error") { category = "failure"; label = "Failure"; }
    else if (type === "status_change") { category = "status_change"; label = "Status change"; progress = true; }
    else if (type === "permission_request") { category = "permission_request"; label = "Permission request"; progress = true; }
    else if (type === "completion") { category = "completion"; label = "Completion"; progress = true; }
  }
  return { category, label, summary, at: entry.timestamp ?? String(item.timestamp ?? ""), progress, ...(heartbeat ? { heartbeat } : {}), ...(longRunning ? { longRunning } : {}) };
}
export function synthesizeAttentionEntry(agent: ObservatoryAgentSnapshot): NormalizedTimelineEntry | null { if (!agent.requiresAttention) return null; const category = agent.attentionReason === "permission" ? "permission_request" : agent.attentionReason === "finished" ? "completion" : agent.attentionReason === "error" ? "failure" : "status_change"; return { category, label: category === "permission_request" ? "Permission request" : category === "completion" ? "Completion" : category === "failure" ? "Failure" : "Status change", summary: agent.status, at: agent.updatedAt, progress: category !== "failure" }; }

export type AttentionReasonKind = "user_input" | "failure" | "inactivity";
export interface AttentionEntry { agentId: string; workspaceId: string; workspaceName: string; reason: AttentionReasonKind; hintedAt: number; episodeId: string }
export const ATTENTION_INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000;
const ATTENTION_REASON_PRIORITY: Record<AttentionReasonKind, number> = { user_input: 0, failure: 1, inactivity: 2 };
export const ATTENTION_REASON_LABELS: Record<AttentionReasonKind, string> = { user_input: "Waiting for you", failure: "Failed", inactivity: "Inactive" };
export interface AttentionAgentInput { agent: ObservatoryAgentSnapshot; timeline?: readonly NormalizedTimelineEntry[] }

export function attentionEpisodeId(reason: AttentionReasonKind, agentId: string, anchor: number | string): string {
  const anchorValue = typeof anchor === "number" ? String(anchor) : String(anchor);
  return `${reason}:${agentId}:${anchorValue}`;
}

/**
 * Derives the project attention queue deterministically from snapshots alone. `now` must be
 * injected by the caller so the result is a pure function of its inputs.
 *
 * Rules (at most one primary reason per agent, priority user input > failure > inactivity):
 * - an explicit pending permission/user-input request raises immediately and clears when answered or resumed;
 * - a terminal failed outcome raises; a transient failure only escalates after the fixed threshold
 *   without any recovery activity;
 * - a working agent raises inactivity after the fixed 15-minute threshold without meaningful
 *   progress; heartbeats reset it only when they report progress or a status change, and observable
 *   long-running operations plus active observable child dependencies pause timing.
 */
export function deriveAttentionQueue(input: {
  project: ObservatoryProject;
  workspaces: readonly ObservatoryWorkspaceSnapshot[];
  agents: readonly AttentionAgentInput[];
  now: number;
  dismissed?: ReadonlySet<string> | readonly { episodeId: string }[];
}): AttentionEntry[] {
  const names = new Map(input.workspaces.filter(w => w.projectId === input.project.id && w.archivingAt === null).map(w => [w.id, w.name] as const));
  const dismissedSet = input.dismissed
    ? input.dismissed instanceof Set
      ? input.dismissed as ReadonlySet<string>
      : new Set((input.dismissed as readonly { episodeId: string }[]).map((entry) => entry.episodeId))
    : null;
  const entries: AttentionEntry[] = [];
  for (const item of input.agents) {
    if (!names.has(item.agent.workspaceId)) continue;
    const reason = deriveAttentionReason(item.agent, item.timeline ?? [], input.agents, input.now);
    if (!reason) continue;
    if (dismissedSet?.has(reason.episodeId)) continue;
    entries.push({ agentId: item.agent.id, workspaceId: item.agent.workspaceId, workspaceName: names.get(item.agent.workspaceId) ?? "", reason: reason.kind, hintedAt: reason.hintedAt, episodeId: reason.episodeId });
  }
  return entries.sort(compareAttentionEntries);
}
function compareAttentionEntries(a: AttentionEntry, b: AttentionEntry): number {
  return ATTENTION_REASON_PRIORITY[a.reason] - ATTENTION_REASON_PRIORITY[b.reason] || a.hintedAt - b.hintedAt || a.agentId.localeCompare(b.agentId);
}
function deriveAttentionReason(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[], all: readonly AttentionAgentInput[], now: number): { kind: AttentionReasonKind; hintedAt: number; episodeId: string } | null {
  function deriveEpisodeId(reason: AttentionReasonKind, agent: ObservatoryAgentSnapshot, requestedAt: number | null, lastFailureAt: number | null, lastProgressAt: number | null): string {
    if (reason === "user_input") {
      const anchor = requestedAt ?? 0;
      return attentionEpisodeId(reason, agent.id, anchor);
    }
    if (reason === "failure") {
      if (lifecycleFor(agent) === "failed") {
        const anchor = lastFailureAt ?? parseTime(agent.updatedAt) ?? 0;
        return attentionEpisodeId(reason, agent.id, anchor);
      }
      const anchor = lastFailureAt ?? 0;
      return attentionEpisodeId(reason, agent.id, anchor);
    }
    const anchor = lastProgressAt ?? parseTime(agent.createdAt) ?? parseTime(agent.updatedAt) ?? 0;
    return attentionEpisodeId(reason, agent.id, anchor);
  }
  const requestedAt = permissionRequestedAt(agent, timeline);
  if (requestedAt !== null) {
    return { kind: "user_input", hintedAt: requestedAt, episodeId: deriveEpisodeId("user_input", agent, requestedAt, null, null) };
  }
  const failure = failureHint(agent, timeline, now);
  if (failure) return failure;
  const inactivity = inactivityHint(agent, timeline, all, now);
  if (inactivity) return inactivity;
  return null;
}

function permissionRequestedAt(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[]): number | null {
  const flagged = agent.pendingPermissions > 0 || agent.attentionReason === "permission";
  const latestRequestAt = latestTime(timeline.filter(e => e.category === "permission_request").map(e => e.at));
  if (!flagged) {
    if (latestRequestAt === null) return null;
    // Without a daemon attention flag the request stands until newer meaningful activity answers or resumes it.
    const superseded = timeline.some(e => e.progress && !e.heartbeat && e.category !== "permission_request" && (parseTime(e.at) ?? -Infinity) > latestRequestAt);
    if (superseded) return null;
  }
  return parseTime(agent.attentionTimestamp) ?? latestRequestAt ?? parseTime(agent.updatedAt) ?? 0;
}
function failureHint(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[], now: number): { kind: "failure"; hintedAt: number; episodeId: string } | null {
  const lastFailureAt = latestTime(timeline.filter(e => e.category === "failure").map(e => e.at));
  if (lifecycleFor(agent) === "failed") {
    const anchor = lastFailureAt ?? parseTime(agent.updatedAt) ?? 0;
    const hintedAt = anchor;
    return { kind: "failure", hintedAt, episodeId: attentionEpisodeId("failure", agent.id, anchor) };
  }
  if (lastFailureAt === null || lastFailureAt > now) return null;
  if (timeline.some(e => e.progress && (parseTime(e.at) ?? -Infinity) > lastFailureAt)) return null;
  if (now - lastFailureAt < ATTENTION_INACTIVITY_THRESHOLD_MS) return null;
  return { kind: "failure", hintedAt: lastFailureAt + ATTENTION_INACTIVITY_THRESHOLD_MS, episodeId: attentionEpisodeId("failure", agent.id, lastFailureAt) };
}
function inactivityHint(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[], all: readonly AttentionAgentInput[], now: number): { kind: "inactivity"; hintedAt: number; episodeId: string } | null {
  if (lifecycleFor(agent) !== "active" || inactivityPaused(agent, timeline, all)) return null;
  const lastProgressAt = latestProgressAt(agent, timeline);
  if (lastProgressAt === null || lastProgressAt > now || now - lastProgressAt < ATTENTION_INACTIVITY_THRESHOLD_MS) return null;
  const hintedAt = lastProgressAt + ATTENTION_INACTIVITY_THRESHOLD_MS;
  const anchor = lastProgressAt;
  return { kind: "inactivity", hintedAt, episodeId: attentionEpisodeId("inactivity", agent.id, anchor) };
}
function latestProgressAt(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[]): number | null {
  // Inactivity measures observed progress only: heartbeats without progress and other
  // non-progress entries never move this forward. Creation time is the fallback for agents
  // whose recent timeline carries no progress entry at all.
  return latestTime(timeline.filter(e => e.progress).map(e => e.at)) ?? parseTime(agent.createdAt) ?? parseTime(agent.updatedAt);
}
function inactivityPaused(agent: ObservatoryAgentSnapshot, timeline: readonly NormalizedTimelineEntry[], all: readonly AttentionAgentInput[]): boolean {
  for (const entry of [...timeline].sort((a, b) => (parseTime(b.at) ?? 0) - (parseTime(a.at) ?? 0))) {
    if (entry.heartbeat) continue;
    if (entry.longRunning) return true;
    break;
  }
  return all.some(item => item.agent.id !== agent.id && item.agent.labels?.[parentLabel] === agent.id && lifecycleFor(item.agent) === "active");
}
function parseTime(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function latestTime(values: readonly (string | null | undefined)[]): number | null {
  let latest: number | null = null;
  for (const value of values) { const parsed = parseTime(value); if (parsed !== null && (latest === null || parsed > latest)) latest = parsed; }
  return latest;
}


