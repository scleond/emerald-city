import type { PluginContext } from "@getpaseo/plugin";
import { AgentObservatoryPanel } from "./main.client";

export default function contribute(plugin: PluginContext) {
  plugin.addWorkspacePanel({
    id: "workspace-observatory",
    title: "Agent Observatory",
    icon: "Telescope",
    context: "workspace",
    Component: AgentObservatoryPanel,
  });
  plugin.addCommandCenterItem({
    id: "open-workspace-observatory",
    title: "Open Agent Observatory",
    icon: "Telescope",
    keywords: ["agents", "status", "workspace"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("workspace-observatory");
    },
  });
  return () => {};
}
