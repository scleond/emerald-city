import { type PluginWorkspacePanelProps, usePaseo } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type {
  ModelUsageBar,
  ObservatoryAgentUsageTurn,
  ObservatoryViewModel,
} from "./observation";
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
      usageSection: {
        gap: layout.compact ? 6 : 8,
      },
      barRow: {
        gap: 2,
        paddingVertical: layout.compact ? 4 : 6,
      },
      barHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
      },
      modelName: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      tokenTotal: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
      barTrack: {
        flexDirection: "row" as const,
        height: layout.compact ? 8 : 10,
        borderRadius: 4,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.surface0,
      },
      segmentFresh: {
        backgroundColor: theme.colors.accent,
      },
      segmentCached: {
        backgroundColor: theme.colors.foregroundMuted,
      },
      segmentOutput: {
        backgroundColor: theme.colors.statusDanger,
      },
      legend: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: layout.compact ? 8 : 14,
      },
      legendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
      },
      legendSwatchFresh: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: theme.colors.accent,
      },
      legendSwatchCached: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: theme.colors.foregroundMuted,
      },
      legendSwatchOutput: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: theme.colors.statusDanger,
      },
      agentPressable: {
        paddingVertical: layout.compact ? 8 : 10,
        gap: 3,
      },
      turnRow: {
        flexDirection: "row" as const,
        alignItems: "flex-end" as const,
        gap: layout.compact ? 6 : 10,
        marginTop: layout.compact ? 4 : 6,
      },
      turnColumn: {
        alignItems: "center" as const,
        gap: 2,
      },
      turnStack: {
        flexDirection: "column-reverse" as const,
        width: layout.compact ? 18 : 24,
        borderRadius: 3,
        overflow: "hidden" as const,
      },
      provisionalLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      detailLine: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        marginTop: layout.compact ? 4 : 6,
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
  workspace: ViewStyle;
  workspaceTitle: TextStyle;
  agentTitle: TextStyle;
  status: TextStyle;
  error: TextStyle;
  usageSection: ViewStyle;
  barRow: ViewStyle;
  barHeader: ViewStyle;
  modelName: TextStyle;
  tokenTotal: TextStyle;
  barTrack: ViewStyle;
  segmentFresh: ViewStyle;
  segmentCached: ViewStyle;
  segmentOutput: ViewStyle;
  legend: ViewStyle;
  legendItem: ViewStyle;
  legendSwatchFresh: ViewStyle;
  legendSwatchCached: ViewStyle;
  legendSwatchOutput: ViewStyle;
  agentPressable: ViewStyle;
  turnRow: ViewStyle;
  turnColumn: ViewStyle;
  turnStack: ViewStyle;
  provisionalLabel: TextStyle;
  detailLine: TextStyle;
}

function StateContent({ state, styles }: { state: ProjectObservationState; styles: PanelStyles }) {
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
  return <ReadyContent view={state.view} styles={styles} />;
}

function ReadyContent({ view, styles }: { view: ObservatoryViewModel; styles: PanelStyles }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
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
      <View style={styles.usageSection}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Usage by model
        </Text>
        {view.models.length === 0 ? (
          <Text style={styles.subtitle}>No reported token usage yet.</Text>
        ) : (
          <>
            {view.models.map((bar) => (
              <ModelBar key={bar.model} bar={bar} styles={styles} />
            ))}
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={styles.legendSwatchFresh} />
                <Text style={styles.tokenTotal}>Fresh input</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendSwatchCached} />
                <Text style={styles.tokenTotal}>Cached input</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={styles.legendSwatchOutput} />
                <Text style={styles.tokenTotal}>Output</Text>
              </View>
            </View>
          </>
        )}
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
            workspace.agents.map((agent) => {
              const selected = agent.id === selectedAgentId;
              return (
                <Pressable
                  key={agent.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${agent.title}, status ${agent.status}`}
                  onPress={() => setSelectedAgentId(selected ? null : agent.id)}
                  style={styles.agentPressable}
                >
                  <Text style={styles.agentTitle}>{agent.title}</Text>
                  <Text style={styles.status}>
                    {agent.lifecycle === "other" ? `Other · ${agent.status}` : agent.status}
                    {agent.model ? ` · ${agent.model}` : ""}
                  </Text>
                  {selected ? (
                    <AgentUsageDetail
                      workspaceName={workspace.name}
                      model={agent.model}
                      turns={agent.usageTurns}
                      switchedModels={agent.switchedModels}
                      styles={styles}
                    />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
      ))}
    </>
  );
}

function ModelBar({ bar, styles }: { bar: ModelUsageBar; styles: PanelStyles }) {
  const total = Math.max(bar.totalTokens, 1);
  return (
    <View
      accessibilityLabel={`${bar.model}: ${bar.totalTokens} tokens, fresh input ${bar.freshInputTokens}, cached input ${bar.cachedInputTokens}, output ${bar.outputTokens}`}
      style={styles.barRow}
    >
      <View style={styles.barHeader}>
        <Text style={styles.modelName}>{bar.model}</Text>
        <Text style={styles.tokenTotal}>{bar.totalTokens.toLocaleString()} tokens</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={{ flex: (bar.freshInputTokens / total) || 0, ...styles.segmentFresh }} />
        <View style={{ flex: (bar.cachedInputTokens / total) || 0, ...styles.segmentCached }} />
        <View style={{ flex: (bar.outputTokens / total) || 0, ...styles.segmentOutput }} />
      </View>
    </View>
  );
}

function AgentUsageDetail({
  workspaceName,
  model,
  turns,
  switchedModels,
  styles,
}: {
  workspaceName: string;
  model: string | null;
  turns: ObservatoryAgentUsageTurn[];
  switchedModels: boolean;
  styles: PanelStyles;
}) {
  const finalized = turns.filter((turn) => !turn.provisional);
  const provisional = turns.find((turn) => turn.provisional);
  return (
    <View>
      <Text style={styles.detailLine}>Workspace: {workspaceName}</Text>
      {model ? <Text style={styles.detailLine}>Current model: {model}</Text> : null}
      {switchedModels ? <Text style={styles.detailLine}>⇄ Model switched across turns</Text> : null}
      {finalized.length === 0 && !provisional ? (
        <Text style={styles.detailLine}>No reported turn usage.</Text>
      ) : null}
      {turns.length > 0 ? (
        <View style={styles.turnRow} accessibilityLabel="Per-turn token usage">
          {turns.map((turn, index) => (
            <TurnColumn key={`${turn.turnId ?? "unknown"}-${index}`} turn={turn} styles={styles} />
          ))}
        </View>
      ) : null}
      <Text style={styles.detailLine}>
        {finalized.some((turn) => turn.costUsd !== null)
          ? `Cost: $${finalized
              .reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0)
              .toFixed(4)}${provisional ? " + live" : ""}`
          : "Cost: unknown"}
      </Text>
      <Text style={styles.detailLine}>
        {(() => {
          const latest = provisional ?? finalized[finalized.length - 1];
          if (!latest || latest.contextUsedTokens === null || !latest.contextMaxTokens) {
            return "Context: unknown";
          }
          return `Context: ${Math.round((latest.contextUsedTokens / latest.contextMaxTokens) * 100)}% of window`;
        })()}
      </Text>
    </View>
  );
}

function TurnColumn({ turn, styles }: { turn: ObservatoryAgentUsageTurn; styles: PanelStyles }) {
  const input = turn.inputTokens ?? 0;
  const cached = Math.min(turn.cachedInputTokens ?? 0, input);
  const fresh = Math.max(0, input - cached);
  const output = turn.outputTokens ?? 0;
  const total = Math.max(input + output, 1);
  return (
    <View
      style={styles.turnColumn}
      accessibilityLabel={
        `${turn.provisional ? "Live turn" : "Turn"}${turn.model ? `, model ${turn.model}` : ""}: ` +
        `${input + output} tokens`
      }
    >
      <View style={styles.turnStack}>
        <View style={{ flex: (fresh / total) || 0, ...styles.segmentFresh }} />
        <View style={{ flex: (cached / total) || 0, ...styles.segmentCached }} />
        <View style={{ flex: (output / total) || 0, ...styles.segmentOutput }} />
      </View>
      <Text style={styles.provisionalLabel}>{turn.provisional ? "live" : (turn.model ?? "?")}</Text>
    </View>
  );
}
