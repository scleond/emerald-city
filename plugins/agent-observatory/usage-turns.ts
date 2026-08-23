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
