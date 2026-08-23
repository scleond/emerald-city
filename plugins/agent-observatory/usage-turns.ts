import { z } from "zod";

const nullableNumber = z.number().finite().nonnegative().nullable();

export const NormalizedUsageTurnSchema = z.object({
  projectId: z.string().min(1),
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  turnId: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  model: z.string().min(1).nullable(),
  inputTokens: nullableNumber,
  cachedInputTokens: nullableNumber,
  outputTokens: nullableNumber,
  contextUsedTokens: nullableNumber,
  contextMaxTokens: nullableNumber,
  costUsd: nullableNumber,
  costState: z.enum(["complete", "partial", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
});
export type NormalizedUsageTurn = z.infer<typeof NormalizedUsageTurnSchema>;

export const UsageTurnStoreFileSchema = z.object({
  version: z.literal(1),
  turns: z.array(NormalizedUsageTurnSchema),
});
export type UsageTurnStoreFile = z.infer<typeof UsageTurnStoreFileSchema>;

export interface UsageTurnFileStorage { read(): Promise<string | null>; write(data: string): Promise<void> }
export interface UsageTurnStore {
  get(scope: { projectId: string; workspaceId: string; agentId: string }): Promise<readonly NormalizedUsageTurn[]>;
  put(turn: NormalizedUsageTurn): Promise<readonly NormalizedUsageTurn[]>;
}

export const USAGE_RANGES = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
} as const;
export type UsageRange = keyof typeof USAGE_RANGES;
export type HistoricalCostState = "exact" | "estimated" | "free-model" | "unknown";
export interface HistoricalUsageProjection {
  range: UsageRange;
  from: number;
  to: number;
  turns: readonly NormalizedUsageTurn[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  recordedTokens: number;
  reportedCostUsd: number | null;
  costState: HistoricalCostState;
}

/** Projects persisted history only; live/provisional usage is deliberately not included. */
export function projectHistoricalUsage(
  turns: readonly NormalizedUsageTurn[],
  range: UsageRange,
  now: number,
): HistoricalUsageProjection {
  const to = now;
  const from = to - USAGE_RANGES[range];
  const selected = turns
    .filter((turn) => turn.confidence !== "low")
    .filter((turn) => {
      const at = Date.parse(turn.completedAt ?? turn.startedAt ?? turn.observedAt);
      return Number.isFinite(at) && at >= from && at <= to;
    })
    .sort((a, b) => (Date.parse(a.completedAt ?? a.startedAt ?? a.observedAt) - Date.parse(b.completedAt ?? b.startedAt ?? b.observedAt)) || a.turnId.localeCompare(b.turnId) || a.agentId.localeCompare(b.agentId));
  let inputTokens = 0; let cachedInputTokens = 0; let outputTokens = 0; let cost = 0; let known = 0; let estimated = 0; let free = 0;
  for (const turn of selected) {
    const input = turn.inputTokens ?? 0;
    inputTokens += input;
    cachedInputTokens += Math.min(Math.max(0, turn.cachedInputTokens ?? 0), input);
    outputTokens += Math.max(0, turn.outputTokens ?? 0);
    if (turn.costUsd !== null) { cost += turn.costUsd; known++; if (turn.costUsd === 0) free++; }
    if (turn.costUsd === null || turn.costState === "partial" || turn.confidence === "medium") estimated++;
  }
  const costState: HistoricalCostState = selected.length === 0 || known === 0 ? "unknown" : estimated > 0 ? "estimated" : free === known ? "free-model" : "exact";
  return { range, from, to, turns: selected, inputTokens, cachedInputTokens, outputTokens, recordedTokens: inputTokens + outputTokens, reportedCostUsd: known === 0 ? null : cost, costState };
}

export const DEFAULT_USAGE_TURN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createUsageTurnStore(options: { storage: UsageTurnFileStorage; now?: () => number; maxAgeMs?: number }): UsageTurnStore {
  const now = options.now ?? (() => Date.now());
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_USAGE_TURN_MAX_AGE_MS;
  let tail = Promise.resolve();
  const lock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
  const empty = (): UsageTurnStoreFile => ({ version: 1, turns: [] });
  const prune = (file: UsageTurnStoreFile): UsageTurnStoreFile => {
    const cutoff = now() - maxAgeMs;
    const turns = file.turns.filter((turn) => {
      const timestamp = Date.parse(turn.completedAt ?? turn.startedAt ?? turn.observedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
    turns.sort((a, b) => a.turnId.localeCompare(b.turnId) || a.agentId.localeCompare(b.agentId));
    return { version: 1, turns };
  };
  async function load(): Promise<UsageTurnStoreFile> {
    const raw = await options.storage.read();
    if (raw === null) return empty();
    try {
      const parsed = UsageTurnStoreFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return empty();
      return prune(parsed.data);
    } catch { return empty(); }
  }
  return {
    get(scope) { return lock(async () => (await load()).turns.filter((t) => t.projectId === scope.projectId && t.workspaceId === scope.workspaceId && t.agentId === scope.agentId)); },
    put(input) { return lock(async () => {
      const turn = NormalizedUsageTurnSchema.parse({ ...input });
      const file = await load();
      const turns = file.turns.filter((t) => !(t.projectId === turn.projectId && t.workspaceId === turn.workspaceId && t.agentId === turn.agentId && t.turnId === turn.turnId));
      const next = prune({ version: 1, turns: [...turns, turn] });
      await options.storage.write(JSON.stringify(next));
      return next.turns.filter((t) => t.projectId === turn.projectId && t.workspaceId === turn.workspaceId && t.agentId === turn.agentId);
    }); },
  };
}
