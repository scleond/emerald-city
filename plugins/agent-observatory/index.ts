import type { PluginContext, PluginHandlerContext } from "@getpaseo/plugin";
import { AgentObservatoryPanel } from "./main.client";
import { observatoryDismissalContracts, type DismissalStore } from "./dismissals";
import { observatoryUsageContracts } from "./usage-turns";
import { repositoryContextSearch, repositoryContextSource } from "./repository-context.shared";
import { searchRepositoryContext } from "./repository-context.server";

let storePromise: Promise<DismissalStore> | null = null;
let usageStorePromise: ReturnType<typeof importUsageStore> | null = null;
function importUsageStore() { return import("./usage-turn-store-node").then((m) => m.createFileUsageTurnStore()); }
function getUsageStore() { if (!usageStorePromise) usageStorePromise = importUsageStore(); return usageStorePromise; }
function getStore(): Promise<DismissalStore> {
  if (!storePromise) storePromise = import("./dismissal-store-node").then((m) => m.createFileDismissalStore());
  return storePromise;
}

export default function contribute(plugin: PluginContext) {
  plugin.addAttachmentSource(repositoryContextSource);
  plugin.handle(repositoryContextSearch, async (input, ctx) => searchRepositoryContext(input, ctx.paseo));
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

  plugin.handle(observatoryUsageContracts.get, async (input) => ({ turns: [...await (await getUsageStore()).get(input)] }));
  plugin.handle(observatoryUsageContracts.put, async (input) => ({ turns: [...await (await getUsageStore()).put(input.turn)] }));

  plugin.handle(observatoryDismissalContracts.removeAgents, async (input, ctx: PluginHandlerContext) => {
    try {
      const store = await getStore();
      // Verify existence via paseo API if available; only remove dismissals for missing agents.
      const paseo = ctx.paseo;
      if (paseo?.agents?.list) {
        try {
          const existingIds = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = await paseo.agents.list({
              page: { limit: 200, ...(cursor ? { cursor } : {}) },
            });
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

  // Reload/shutdown cleanup: daemon-side plugin owns no long-lived subscriptions or timers;
  // RPC handlers are owned by the plugin runtime and released when this cleanup runs.
  // Reset the lazy store promise so a subsequent reload re-creates a fresh store without
  // carrying stale file handles or cached state.
  return () => {
    storePromise = null;
    usageStorePromise = null;
  };
}
