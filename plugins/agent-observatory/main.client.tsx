import { type PluginWorkspacePanelProps, usePaseo } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { ScrollView, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { ObservatoryViewModel } from "./observation";
import {
  WorkspaceObservationController,
  type WorkspaceObservationState,
} from "./workspace-observation";

export function AgentObservatoryPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const controller = useMemo(
    () => new WorkspaceObservationController(paseo, workspaceId),
    [paseo, workspaceId],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

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
      <StateContent state={state} styles={styles} />
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
  agentTitle: TextStyle;
  status: TextStyle;
  error: TextStyle;
}

function StateContent({ state, styles }: { state: WorkspaceObservationState; styles: PanelStyles }) {
  if (state.phase === "loading") {
    return <Text style={styles.subtitle}>Loading workspace agents…</Text>;
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
  return <ReadyContent view={state.view} styles={styles} />;
}

function ReadyContent({ view, styles }: { view: ObservatoryViewModel; styles: PanelStyles }) {
  return (
    <>
      <Text style={styles.subtitle}>{view.workspace.name}</Text>
      <View accessibilityLabel="Agent lifecycle summary" style={styles.summary}>
        {view.counts.map(({ label, count }) => (
          <View key={label} accessibilityLabel={`${label}: ${count}`}>
            <Text style={styles.count}>{count}</Text>
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Agents
      </Text>
      {view.agents.length === 0 ? (
        <Text style={styles.subtitle}>No agents are currently available in this workspace.</Text>
      ) : (
        view.agents.map((agent) => (
          <View key={agent.id} accessibilityLabel={`${agent.title}, status ${agent.status}`} style={styles.row}>
            <Text style={styles.agentTitle}>{agent.title}</Text>
            <Text style={styles.status}>
              {agent.lifecycle === "other" ? `Other · ${agent.status}` : agent.status}
            </Text>
          </View>
        ))
      )}
    </>
  );
}
