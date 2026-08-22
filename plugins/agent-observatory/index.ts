import type { PluginContext } from "@getpaseo/plugin";
import { AgentObservatoryPanel } from "./main.client";
import { observatoryDismissalContracts, type DismissalStore } from "./dismissals";

let storePromise: Promise<DismissalStore> | null = null;
function getStore(): Promise<DismissalStore> {
  if (!storePromise) storePromise = import("./dismissal-store-node").then((m) => m.createFileDismissalStore());
  return storePromise;
}

export default function contribute(plugin: PluginContext) {
  plugin.addWorkspacePanel({
    id: "project-observatory",
    title: "Agent Observatory",
    icon: "Telescope",
    context: "workspace",
    Component: AgentObservatoryPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-project-observatory",
    title: "Open Agent Observatory",
    icon: "Telescope",
    keywords: ["agents", "status", "project", "workspace"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("project-observatory");
    },
  });

  plugin.handle(observatoryDismissalContracts.get, async (input) => {
    try {
      const store = await getStore();
      const dismissals = await store.get(input.projectId);
      return { dismissals: [...dismissals] };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

  plugin.handle(observatoryDismissalContracts.put, async (input) => {
    try {
      const store = await getStore();
      const dismissals = await store.put(input.projectId, input.dismissal);
      return { dismissals: [...dismissals] };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

  plugin.handle(observatoryDismissalContracts.removeAgents, async (input, ctx) => {
    try {
      const store = await getStore();
      // Verify existence via paseo API if available; only remove dismissals for missing agents.
      const maybeCtx = ctx as unknown as { paseo?: any };
      const paseo = maybeCtx?.paseo as { agents?: { list?: (args?: unknown) => Promise<{ entries: { agent: { id: string } }[]; pageInfo?: { hasMore?: boolean; nextCursor?: string } }> } | undefined } | undefined;
      if (paseo?.agents?.list) {
        try {
          const existingIds = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = await paseo.agents.list({
              page: { limit: 200, ...(cursor ? { cursor } : {}) },
            } as unknown as never);
            for (const entry of page.entries) existingIds.add(entry.agent.id);
            cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? undefined : undefined;
          } while (cursor);
          const removable = input.agentIds.filter((id) => !existingIds.has(id));
          if (removable.length === 0) {
            const dismissals = await store.get(input.projectId);
            return { dismissals: [...dismissals] };
          }
          const dismissals = await store.removeAgents(input.projectId, removable);
          return { dismissals: [...dismissals] };
        } catch {
          // Fall through to direct removal if verification fails
        }
      }
      const dismissals = await store.removeAgents(input.projectId, input.agentIds);
      return { dismissals: [...dismissals] };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  });

  return () => {};
}
