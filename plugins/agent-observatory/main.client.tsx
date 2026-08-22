import { type PluginWorkspacePanelProps, usePaseo } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import type { AgentLifecycle } from "./observation";
import type { ObservatoryViewModel } from "./observation";
import {
  ProjectObservationController,
  type ProjectObservationState,
} from "./project-observation";

export function AgentObservatoryPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const controller = useMemo(
    () => new ProjectObservationController(paseo, workspaceId),
    [paseo, workspaceId],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [query, setQuery] = React.useState("");
  const [lifecycle, setLifecycle] = React.useState<AgentLifecycle | undefined>();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  useEffect(() => { controller.setFilters(query, lifecycle ? [lifecycle] : []); }, [controller, query, lifecycle]);

  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller]);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      content: {
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 12 : 18,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 22 : 28,
        fontWeight: "700" as const,
      },
      subtitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
      },
      summary: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: layout.compact ? 12 : 20,
      },
      count: {
        color: theme.colors.foreground,
        fontSize: layout.compact ? 20 : 24,
        fontWeight: "700" as const,
      },
      label: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      sectionTitle: {
        color: theme.colors.foreground,
        fontSize: 17,
        fontWeight: "600" as const,
      },
      row: {
        gap: 3,
        paddingVertical: layout.compact ? 8 : 10,
      },
      workspace: {
        gap: layout.compact ? 4 : 6,
      },
      workspaceTitle: {
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "600" as const,
      },
      agentTitle: {
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "500" as const,
      },
      status: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
      error: {
        color: theme.colors.statusDanger,
        fontSize: 15,
      },
    }),
    [layout.compact, theme],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Agent Observatory
      </Text>
      <TextInput placeholder="Search workspaces or agents" value={query} onChangeText={setQuery} style={{ color: theme.colors.foreground, borderWidth: 1, padding: 8 }} />
      <View style={styles.summary}>{(["active", "waiting", "finished", "failed", "other"] as AgentLifecycle[]).map(value => <Pressable key={value} onPress={() => setLifecycle(lifecycle === value ? undefined : value)}><Text style={styles.label}>{value}</Text></Pressable>)}</View>
      <StateContent state={state} styles={styles} selectedAgentId={selectedAgentId} selectAgent={(id) => { setSelectedAgentId(id); void controller.loadTimeline(id); }} loadMore={(id) => void controller.loadTimeline(id, true)} />
    </ScrollView>
  );
}

interface PanelStyles {
  screen: ViewStyle;
  content: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  summary: ViewStyle;
  count: TextStyle;
  label: TextStyle;
  sectionTitle: TextStyle;
  row: ViewStyle;
  workspace: ViewStyle;
  workspaceTitle: TextStyle;
  agentTitle: TextStyle;
  status: TextStyle;
  error: TextStyle;
}

function StateContent({ state, styles, selectedAgentId, selectAgent, loadMore }: { state: ProjectObservationState; styles: PanelStyles; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void }) {
  if (state.phase === "loading") {
    return <Text style={styles.subtitle}>Loading project agents…</Text>;
  }
  if (state.phase === "disconnected") {
    return (
      <View accessibilityRole="alert">
        <Text style={styles.error}>Host disconnected</Text>
        <Text style={styles.subtitle}>{state.message} Observatory will reconnect automatically.</Text>
      </View>
    );
  }
  if (state.phase === "unavailable") {
    return (
      <View accessibilityRole="alert">
        <Text style={styles.error}>Data unavailable</Text>
        <Text style={styles.subtitle}>{state.message}</Text>
      </View>
    );
  }
  return <ReadyContent view={state.view} styles={styles} selectedAgentId={selectedAgentId} selectAgent={selectAgent} loadMore={loadMore} timeline={state.timeline ?? {}} />;
}

function ReadyContent({ view, styles, selectedAgentId, selectAgent, loadMore, timeline }: { view: ObservatoryViewModel; styles: PanelStyles; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void; timeline: Record<string, { entries: { label: string; summary: string; at: string }[]; error?: string; hasOlder: boolean }> }) {
  const agentCount = view.workspaces.reduce((total, workspace) => total + workspace.agents.length, 0);
  return (
    <>
      <Text style={styles.subtitle}>{view.project.name}</Text>
      <View accessibilityLabel="Agent lifecycle summary" style={styles.summary}>
        {view.counts.map(({ label, count }) => (
          <View key={label} accessibilityLabel={`${label}: ${count}`}>
            <Text style={styles.count}>{count}</Text>
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Workspaces
      </Text>
      {agentCount === 0 ? (
        <Text style={styles.subtitle}>No agents are currently available in this project.</Text>
      ) : null}
      {view.workspaces.map((workspace) => (
        <View key={workspace.id} style={styles.workspace}>
          <Text accessibilityRole="header" style={styles.workspaceTitle}>
            {workspace.name}
          </Text>
          {workspace.agents.length === 0 ? (
            <Text style={styles.subtitle}>No agents</Text>
            ) : (
            workspace.agents.map((agent) => (
                <Pressable onPress={() => selectAgent(agent.id)}
                key={agent.id}
                accessibilityLabel={`${agent.title}, status ${agent.status}`}
                style={styles.row}
              >
                  <Text style={[styles.agentTitle, { marginLeft: agent.depth * 12 }]}>{agent.title} {agent.parentId ? `(↳ from ${agent.parentTitle ?? "unknown parent"})` : ""}</Text>
                <Text style={styles.status}>
                  {agent.lifecycle === "other" ? `Other · ${agent.status}` : agent.status}
                </Text>
                </Pressable>
            ))
          )}
        </View>
      ))}
      {selectedAgentId && timeline[selectedAgentId] ? <View><Text style={styles.sectionTitle}>Activity</Text>{timeline[selectedAgentId].error ? <Text style={styles.error}>{timeline[selectedAgentId].error}</Text> : null}{timeline[selectedAgentId].entries.map((entry, index) => <Text key={`${entry.at}-${index}`} style={styles.status}>{entry.label}: {entry.summary}</Text>)}{timeline[selectedAgentId].hasOlder ? <Pressable onPress={() => loadMore(selectedAgentId)}><Text style={styles.label}>Load more</Text></Pressable> : null}</View> : null}
    </>
  );
}
