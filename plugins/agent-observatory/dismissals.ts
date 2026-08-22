import { z } from "zod";
import { defineRpc } from "@getpaseo/plugin";

export const ATTENTION_REASON_VALUES = ["user_input", "failure", "inactivity"] as const;

export const AttentionDismissalRecordSchema = z.object({
  agentId: z.string().min(1),
  episodeId: z.string().min(1),
  reason: z.enum(ATTENTION_REASON_VALUES),
  workspaceId: z.string().min(1).optional(),
  dismissedAt: z.iso.datetime({ offset: true }),
});

export type AttentionDismissalRecord = z.infer<typeof AttentionDismissalRecordSchema>;

export const ProjectIdSchema = z.string().min(1);

export const DismissalStoreFileSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), z.array(AttentionDismissalRecordSchema)),
});

export type DismissalStoreFile = z.infer<typeof DismissalStoreFileSchema>;

export const observatoryDismissalContracts = {
  get: defineRpc({
    name: "agent-observatory.dismissals.get",
    input: z.object({ projectId: ProjectIdSchema }),
    output: z.object({ dismissals: z.array(AttentionDismissalRecordSchema) }),
  }),
  put: defineRpc({
    name: "agent-observatory.dismissals.put",
    input: z.object({ projectId: ProjectIdSchema, dismissal: AttentionDismissalRecordSchema }),
    output: z.object({ dismissals: z.array(AttentionDismissalRecordSchema) }),
  }),
  removeAgents: defineRpc({
    name: "agent-observatory.dismissals.remove-agents",
    input: z.object({ projectId: ProjectIdSchema, agentIds: z.array(z.string().min(1)).max(500) }),
    output: z.object({ dismissals: z.array(AttentionDismissalRecordSchema) }),
  }),
};

export interface DismissalFileStorage {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
}

export interface DismissalStore {
  get(projectId: string): Promise<readonly AttentionDismissalRecord[]>;
  put(projectId: string, dismissal: AttentionDismissalRecord): Promise<readonly AttentionDismissalRecord[]>;
  removeAgents(projectId: string, agentIds: readonly string[]): Promise<readonly AttentionDismissalRecord[]>;
}

export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createDismissalStore(options: {
  storage: DismissalFileStorage;
  now?: () => number;
  maxAgeMs?: number;
}): DismissalStore {
  const nowFn = options.now ?? (() => Date.now());
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  let cache: DismissalStoreFile | null = null;
  let tail: Promise<void> = Promise.resolve();

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    // ensure tail always resolves to keep chain alive
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function cloneFile(file: DismissalStoreFile): DismissalStoreFile {
    return {
      version: 1,
      projects: Object.fromEntries(
        Object.entries(file.projects).map(([projectId, dismissals]) => [projectId, [...dismissals]]),
      ),
    };
  }

  function prune(file: DismissalStoreFile): DismissalStoreFile {
    const now = nowFn();
    const pruned: Record<string, AttentionDismissalRecord[]> = {};
    for (const [projectId, dismissals] of Object.entries(file.projects)) {
      const kept = dismissals.filter((record) => {
        const dismissedAtMs = Date.parse(record.dismissedAt);
        if (!Number.isFinite(dismissedAtMs)) return false;
        return now - dismissedAtMs <= maxAgeMs;
      });
      kept.sort((a, b) => Date.parse(a.dismissedAt) - Date.parse(b.dismissedAt));
      if (kept.length > 0) pruned[projectId] = kept;
    }
    return { version: 1, projects: pruned };
  }

  async function loadAll(): Promise<DismissalStoreFile> {
    let raw: string | null;
    try {
      raw = await options.storage.read();
    } catch (error) {
      throw error;
    }
    if (raw === null) {
      return { version: 1, projects: {} };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Dismissal store corrupted: invalid JSON");
    }
    const result = DismissalStoreFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Dismissal store schema mismatch: ${result.error.message}`);
    }
    const pruned = prune(result.data);
    // Ensure sorted even if not pruned removed anything; prune sorts.
    return pruned;
  }

  async function ensureLoaded(): Promise<DismissalStoreFile> {
    if (cache) return cache;
    const loaded = await loadAll();
    cache = loaded;
    // If pruning removed expired entries, persist the pruned state without overwriting corrupted case (we already threw).
    // Check if loaded differs from raw file length? We need to detect if pruning changed data; compare JSON lengths or check original raw vs pruned.
    // To avoid extra read, we attempt to write pruned back only if it differs from what was read.
    // We read raw again? Instead, we can check if any entries were removed due to TTL by comparing pruned projects vs parsed projects.
    // Simpler: if we detected prune, we try to persist but failure should not block load.
    // We need raw parsed to compare; redo logic: we have pruned, but we don't know if anything pruned. We'll check if raw file contained expired entries by checking if prune removed any.
    // Since loadAll already pruned, we can attempt to persist if pruned is different from original parsed data.
    // To do that, we need original parsed; we already have it as result.data. Compare quickly.
    // For now, handle persistence of prune via checking if pruned projects differ from result.data projects in loadAll.
    // To avoid double complexity, we handle prune persistence in loadAll after parsing: if pruned !== result.data (by JSON), write back.
    // But we cannot easily do that inside loadAll without causing recursion. Instead, do it here: if cache was null, we loaded pruned; we should attempt to write back if pruning occurred.
    // We'll attempt to detect and write: compare pruned vs original parsed length. However loadAll returns pruned, we lost original. So we need to handle prune write inside loadAll.
    return cache;
  }

  // Wrap loadAll to also persist prune if needed, but we need to avoid overwrite on corrupted case.
  // Instead, implement a dedicated load that optionally persists prune.
  async function loadAndMaybePrune(): Promise<DismissalStoreFile> {
    // Always re-read to reflect cross-client writes and external changes
    // Do not short-circuit on cache
    let raw: string | null;
    try {
      raw = await options.storage.read();
    } catch (error) {
      throw error;
    }
    if (raw === null) {
      cache = { version: 1, projects: {} };
      return cache;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Dismissal store corrupted: invalid JSON");
    }
    const result = DismissalStoreFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Dismissal store schema mismatch: ${result.error.message}`);
    }
    const pruned = prune(result.data);
    // Check if pruning changed anything
    const originalJson = JSON.stringify(result.data);
    const prunedJson = JSON.stringify(pruned);
    if (originalJson !== prunedJson) {
      // Persist pruned state; clone to avoid mutating cache on failure
      try {
        await options.storage.write(JSON.stringify(pruned));
      } catch {
        // Swallow prune persist failure; still return pruned in memory but don't update cache to persisted state?
        // We still set cache to pruned so subsequent reads see pruned.
      }
    }
    cache = pruned;
    return cache;
  }

  return {
    async get(projectId: string): Promise<readonly AttentionDismissalRecord[]> {
      const parsedId = ProjectIdSchema.parse(projectId);
      return withLock(async () => {
        const file = await loadAndMaybePrune();
        // Re-prune in case time progressed since last load (TTL)
        const now = nowFn();
        const dismissals = file.projects[parsedId] ?? [];
        const filtered = dismissals.filter((record) => now - Date.parse(record.dismissedAt) <= maxAgeMs);
        // If TTL filtering removed something, we need to update cache and persist
        if (filtered.length !== dismissals.length) {
          const next = cloneFile(file);
          if (filtered.length === 0) delete next.projects[parsedId];
          else next.projects[parsedId] = filtered;
          const prunedNext = prune(next);
          try {
            await options.storage.write(JSON.stringify(prunedNext));
            cache = prunedNext;
            return [...(prunedNext.projects[parsedId] ?? [])];
          } catch (error) {
            throw error;
          }
        }
        return [...filtered];
      });
    },

    async put(projectId: string, dismissal: AttentionDismissalRecord): Promise<readonly AttentionDismissalRecord[]> {
      const parsedProjectId = ProjectIdSchema.parse(projectId);
      const parsedDismissal = AttentionDismissalRecordSchema.parse(dismissal);
      return withLock(async () => {
        const file = await loadAndMaybePrune();
        const next = cloneFile(file);
        const list = next.projects[parsedProjectId] ? [...next.projects[parsedProjectId]] : [];
        const filtered = list.filter(
          (record) => !(record.agentId === parsedDismissal.agentId && record.episodeId === parsedDismissal.episodeId),
        );
        filtered.push(parsedDismissal);
        filtered.sort((a, b) => Date.parse(a.dismissedAt) - Date.parse(b.dismissedAt));
        // Apply TTL prune to filtered list
        const now = nowFn();
        const kept = filtered.filter((record) => now - Date.parse(record.dismissedAt) <= maxAgeMs);
        if (kept.length === 0) delete next.projects[parsedProjectId];
        else next.projects[parsedProjectId] = kept;
        // Also prune other projects
        const pruned = prune(next);
        // Persist
        try {
          await options.storage.write(JSON.stringify(pruned));
        } catch (error) {
          throw error;
        }
        cache = pruned;
        return [...(pruned.projects[parsedProjectId] ?? [])];
      });
    },

    async removeAgents(projectId: string, agentIds: readonly string[]): Promise<readonly AttentionDismissalRecord[]> {
      const parsedProjectId = ProjectIdSchema.parse(projectId);
      const parsedAgentIds = z.array(z.string().min(1)).max(500).parse([...agentIds]);
      if (parsedAgentIds.length === 0) {
        return withLock(async () => {
          const file = await loadAndMaybePrune();
          return [...(file.projects[parsedProjectId] ?? [])];
        });
      }
      const toRemove = new Set(parsedAgentIds);
      return withLock(async () => {
        const file = await loadAndMaybePrune();
        const existing = file.projects[parsedProjectId];
        if (!existing) return [];
        const next = cloneFile(file);
        const filtered = existing.filter((record) => !toRemove.has(record.agentId));
        if (filtered.length === existing.length) {
          return [...filtered];
        }
        if (filtered.length === 0) delete next.projects[parsedProjectId];
        else next.projects[parsedProjectId] = filtered;
        const pruned = prune(next);
        try {
          await options.storage.write(JSON.stringify(pruned));
        } catch (error) {
          throw error;
        }
        cache = pruned;
        return [...(pruned.projects[parsedProjectId] ?? [])];
      });
    },
  };
}
