import type { PluginContext } from "@getpaseo/plugin";
import { AgentObservatoryPanel } from "./main.client";

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
  return () => {};
}
