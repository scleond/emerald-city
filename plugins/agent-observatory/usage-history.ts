import { projectHistoricalUsage, type NormalizedUsageTurn, type UsageRange } from "./usage-turns";

export const USAGE_RANGE_LABELS: Record<UsageRange, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

export function projectHistoryForRange(turns: readonly NormalizedUsageTurn[], range: UsageRange, now: number) {
  return projectHistoricalUsage(turns, range, now);
}

/** Export only the stable, normalized usage contract. Never serialize event payloads. */
export function sanitizedUsageExport(turns: readonly NormalizedUsageTurn[]): string {
  return JSON.stringify({ version: 1, turns: turns.map(({ projectId, workspaceId, agentId, turnId, observedAt, startedAt, completedAt, model, inputTokens, cachedInputTokens, outputTokens, contextUsedTokens, contextMaxTokens, costUsd, costState, confidence }) => ({ projectId, workspaceId, agentId, turnId, observedAt, startedAt, completedAt, model, inputTokens, cachedInputTokens, outputTokens, contextUsedTokens, contextMaxTokens, costUsd, costState, confidence })) });
}

export function prepareSanitizedUsageExport(turns: readonly NormalizedUsageTurn[]): { data?: string; error?: string } {
  try { return { data: sanitizedUsageExport(turns) }; } catch { return { error: "Export failed; try again." }; }
}

export function historySourceLabel(projection: ReturnType<typeof projectHistoricalUsage>): string {
  if (projection.turns.length === 0) return "Locally observed · no records in this range";
  const newest = projection.turns[projection.turns.length - 1];
  return `Locally observed · last record ${newest.observedAt}`;
}
