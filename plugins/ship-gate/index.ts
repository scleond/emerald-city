import type { PluginContext } from "@getpaseo/plugin";
import { runShipGate } from "./ship-gate";
import { ShipGatePanel } from "./main.client";
import { cancelShipGateRpc, runShipGateRpc } from "./rpc";
const inFlight = new Map<string, { controller: AbortController; token: symbol }>();

export default function contribute(plugin: PluginContext) {
  plugin.addWorkspacePanel({ id: "ship-gate", title: "Ship Gate", icon: "ShieldCheck", context: "workspace", Component: ShipGatePanel });
  // The daemon adapter intentionally accepts only a workspace path and a trusted policy
  // assembled by configuration; no client RPC accepts arbitrary command text in this MVP.
  void runShipGate;
  plugin.handle(runShipGateRpc, async (input, ctx) => {
    const workspace = (await ctx.paseo.workspaces.list()).entries.find((entry) => entry.id === input.workspaceId); if (!workspace) throw new Error("workspace is not authorized or no longer exists");
    const key = `${input.workspaceId}:${input.runToken}`; const previous = inFlight.get(key); if (previous) previous.controller.abort(); const token = Symbol(key); const controller = new AbortController(); inFlight.set(key, { controller, token });
    const commands = input.policy.commandIds.map((id) => ({ id, title: id, executable: "git", args: ["status", "--short"] as const }));
    try { const report = await runShipGate(workspace.workspaceDirectory, { requiredFiles: input.policy.requiredFiles, commands, allowedCommands: Object.fromEntries(commands.map((c) => [c.id, { executable: c.executable, args: [...c.args] }])) }, { signal: controller.signal });
      return { generation: input.generation, report: { ...report, results: [...report.results] } }; } finally { if (inFlight.get(key)?.token === token) inFlight.delete(key); }
  });
  plugin.handle(cancelShipGateRpc, async (input, ctx) => { const authorized = (await ctx.paseo.workspaces.list()).entries.some((entry) => entry.id === input.workspaceId); if (!authorized) throw new Error("workspace is not authorized or no longer exists"); const entry = inFlight.get(`${input.workspaceId}:${input.runToken}`); if (entry) entry.controller.abort(); return { cancelled: Boolean(entry) }; });
}
