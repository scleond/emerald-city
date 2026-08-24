import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const runShipGateRpc = defineRpc({
  name: "ship-gate.run",
  input: z.object({ generation: z.number().int().nonnegative(), runToken: z.string().min(16).max(256), workspaceId: z.string().min(1).max(256), policy: z.object({ commandIds: z.array(z.enum(["git-status"])).max(8).default([]), requiredFiles: z.array(z.string().min(1).max(512)).max(128).refine((files) => files.reduce((n, file) => n + file.length, 0) <= 16_384, "requiredFiles request too large").default([]) }).default({ commandIds: [], requiredFiles: [] }) }),
  output: z.object({ generation: z.number().int().nonnegative(), report: z.object({ workspace: z.string().max(4096), collectedAt: z.string().max(128), generatedText: z.string().max(16000), generatedTextTruncated: z.boolean(), results: z.array(z.object({ id: z.string().max(256), title: z.string().max(512), status: z.enum(["passed", "failed", "skipped", "unavailable", "error"]), evidence: z.string().max(16000), durationMs: z.number().finite().nonnegative().max(3600000), collectedAt: z.string().max(128), freshness: z.enum(["fresh", "stale"]), outcome: z.enum(["complete", "partial", "timeout", "cancelled", "malformed-listing", "operational-error"]), truncated: z.boolean(), incomplete: z.boolean(), errorKind: z.string().max(128).optional(), detail: z.string().max(2048).optional() })).max(256) }) }),
});
export const cancelShipGateRpc = defineRpc({ name: "ship-gate.cancel", input: z.object({ generation: z.number().int().nonnegative(), runToken: z.string().min(16).max(256), workspaceId: z.string().min(1).max(256) }), output: z.object({ cancelled: z.boolean() }) });
