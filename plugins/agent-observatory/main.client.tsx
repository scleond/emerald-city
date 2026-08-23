import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { ATTENTION_REASON_LABELS, finalizedTurnScale, selectedAgentAfterProjection, turnBarHeight, type AgentLifecycle, type AttentionEntry, type AttentionReasonKind, type ModelUsageBar, type ObservatoryAgentUsageTurn } from "./observation";
import type { ObservatoryViewModel } from "./observation";
import {
  ProjectObservationController,
  type ProjectObservationState,
} from "./project-observation";
import { observatoryDismissalContracts, type AttentionDismissalRecord } from "./dismissals";
import { modelUsageAccessibilityLabel } from "./accessibility";

export function AgentObservatoryPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const getDismissals = useRpc(observatoryDismissalContracts.get);
  const putDismissal = useRpc(observatoryDismissalContracts.put);
  const removeAgentsDismissal = useRpc(observatoryDismissalContracts.removeAgents);
  const dismissalApi = useMemo(
    () => ({
      get: async (projectId: string) => {
        const result = await getDismissals({ projectId });
        return result.dismissals;
      },
      put: async (projectId: string, dismissal: AttentionDismissalRecord) => {
        const result = await putDismissal({ projectId, dismissal });
        return result.dismissals;
      },
      removeAgents: async (projectId: string, agentIds: readonly string[]) => {
        const result = await removeAgentsDismissal({ projectId, agentIds: [...agentIds] });
        return result.dismissals;
      },
    }),
    [getDismissals, putDismissal, removeAgentsDismissal],
  );
  const controller = useMemo(
    () => new ProjectObservationController(paseo, workspaceId, undefined, undefined, dismissalApi),
    [paseo, workspaceId, dismissalApi],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [query, setQuery] = React.useState("");
  const [lifecycle, setLifecycle] = React.useState<AgentLifecycle | undefined>();
  const [selectedAgentId, setSelectedAgentId] = React.useState<string | null>(null);
  const [secondaryOpen, setSecondaryOpen] = React.useState(false);
  const [attentionOpen, setAttentionOpen] = React.useState(false);
  useEffect(() => { controller.setFilters(query, lifecycle ? [lifecycle] : []); }, [controller, query, lifecycle]);
  useEffect(() => {
    if (state.phase === "ready") {
      const next = selectedAgentAfterProjection(selectedAgentId, state.view.dashboard.agents);
      if (next !== selectedAgentId) setSelectedAgentId(next);
    }
  }, [selectedAgentId, state]);

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
      card: {
        flexGrow: 1,
        flexBasis: layout.compact ? "100%" as unknown as number : "21%" as unknown as number,
        minWidth: layout.compact ? "100%" as unknown as number : 130,
        padding: 14,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        gap: 4,
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
      attentionRow: {
        gap: 2,
        paddingVertical: layout.compact ? 8 : 10,
        paddingHorizontal: layout.compact ? 10 : 12,
        borderRadius: 10,
      },
      reasonUserInput: {
        color: theme.colors.accent,
        fontSize: layout.compact ? 12 : 13,
        fontWeight: "700" as const,
      },
      reasonFailure: {
        color: theme.colors.statusDanger,
        fontSize: layout.compact ? 12 : 13,
        fontWeight: "700" as const,
      },
      reasonInactivity: {
        color: theme.colors.foregroundMuted,
        fontSize: layout.compact ? 12 : 13,
        fontWeight: "700" as const,
      },
      workspaceBadge: {
        color: theme.colors.accentForeground,
        backgroundColor: theme.colors.accent,
        alignSelf: "flex-start" as const,
        overflow: "hidden" as const,
        fontSize: 11,
        fontWeight: "600" as const,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
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
      segmentOutput: { backgroundColor: theme.colors.accentForeground },
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
        backgroundColor: theme.colors.accentForeground,
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
      dismissButton: {
        alignSelf: "flex-start" as const,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.accent,
      },
      dismissLabel: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      analysisRow: {
        flexDirection: layout.compact ? "column" as const : "row" as const,
        gap: layout.compact ? 12 : 18,
      },
      treePanel: {
        flex: layout.compact ? undefined : 1,
        flexBasis: layout.compact ? undefined : "33%" as unknown as number,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        padding: 12,
        gap: 4,
      },
      detailPanel: {
        flex: layout.compact ? undefined : 2,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        padding: 12,
        gap: 4,
        minHeight: 180,
      },
      secondary: {
        gap: 8,
        padding: 10,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
      },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      control: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        minHeight: 44,
        paddingVertical: 14,
      },
    }),
    [layout.compact, theme],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 }}>TOKEN USAGE</Text>
      <Text accessibilityRole="header" style={styles.title}>Agent Observatory</Text>
      <View accessibilityLabel="Secondary dashboard controls" style={styles.secondary}>
        <Pressable accessibilityRole="button" onPress={() => setSecondaryOpen(!secondaryOpen)}>
          <Text style={styles.control}>{secondaryOpen ? "Hide filters" : "Search and filter agents"}</Text>
        </Pressable>
        {secondaryOpen ? <>
          <TextInput accessibilityLabel="Search workspaces or agents" placeholder="Search workspaces or agents" value={query} onChangeText={setQuery} style={{ color: theme.colors.foreground, borderWidth: 1, padding: 8 }} />
          <View style={styles.toolbar}>{(["active", "waiting", "finished", "failed", "other"] as AgentLifecycle[]).map(value => <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: lifecycle === value }} accessibilityLabel={`Filter agents by ${value}`} onPress={() => setLifecycle(lifecycle === value ? undefined : value)}><Text style={styles.label}>{lifecycle === value ? `✓ ${value}` : value}</Text></Pressable>)}</View>
        </> : null}
      </View>
      <StateContent state={state} styles={styles} selectedAgentId={selectedAgentId} selectAgent={(id) => { setSelectedAgentId(id || null); if (id) void controller.loadTimeline(id); }} loadMore={(id) => void controller.loadTimeline(id, true)} onDismiss={(entry) => void controller.dismissAttention(entry)} attentionOpen={attentionOpen} toggleAttention={() => setAttentionOpen(!attentionOpen)} />
    </ScrollView>
  );
}

interface PanelStyles {
  screen: ViewStyle;
  content: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  summary: ViewStyle;
  card: ViewStyle;
  count: TextStyle;
  label: TextStyle;
  sectionTitle: TextStyle;
  row: ViewStyle;
  workspace: ViewStyle;
  workspaceTitle: TextStyle;
  agentTitle: TextStyle;
  status: TextStyle;
  attentionRow: ViewStyle;
  reasonUserInput: TextStyle;
  reasonFailure: TextStyle;
  reasonInactivity: TextStyle;
  workspaceBadge: TextStyle;
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
  dismissButton: ViewStyle;
  dismissLabel: TextStyle;
  analysisRow: ViewStyle;
  treePanel: ViewStyle;
  detailPanel: ViewStyle;
  secondary: ViewStyle;
  toolbar: ViewStyle;
  control: TextStyle;
}

const ATTENTION_REASON_STYLES: Record<AttentionReasonKind, keyof PanelStyles> = {
  user_input: "reasonUserInput",
  failure: "reasonFailure",
  inactivity: "reasonInactivity",
};

function AttentionQueue({ attention, titles, styles, selectAgent, onDismiss, expanded, onToggle }: { attention: AttentionEntry[]; titles: Map<string, string>; styles: PanelStyles; selectAgent: (id: string) => void; onDismiss: (entry: AttentionEntry) => void; expanded: boolean; onToggle: () => void }) {
  if (attention.length === 0) return null;
  return (
    <View accessibilityLabel="Project attention queue">
      <Pressable accessibilityRole="button" onPress={onToggle}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Needs attention ({attention.length}) {expanded ? "▴" : "▾"}</Text>
      </Pressable>
      {expanded ? attention.map((entry) => (
        <Pressable
          key={`${entry.agentId}-${entry.episodeId}`}
          onPress={() => selectAgent(entry.agentId)}
          accessibilityLabel={`${ATTENTION_REASON_LABELS[entry.reason]}: ${titles.get(entry.agentId) ?? entry.agentId} in ${entry.workspaceName}`}
          style={styles.attentionRow}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles[ATTENTION_REASON_STYLES[entry.reason]]}>{ATTENTION_REASON_LABELS[entry.reason]}</Text>
            <Text style={styles.workspaceBadge}>{entry.workspaceName}</Text>
          </View>
          <Text style={styles.agentTitle}>{titles.get(entry.agentId) ?? entry.agentId}</Text>
          <Pressable
            onPress={() => onDismiss(entry)}
            accessibilityLabel={`Dismiss ${ATTENTION_REASON_LABELS[entry.reason]} for ${titles.get(entry.agentId) ?? entry.agentId}`}
            style={styles.dismissButton}
          >
            <Text style={styles.dismissLabel}>Dismiss</Text>
          </Pressable>
        </Pressable>
      )) : null}
    </View>
  );
}

function StateContent({ state, styles, selectedAgentId, selectAgent, loadMore, onDismiss, attentionOpen, toggleAttention }: { state: ProjectObservationState; styles: PanelStyles; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void; onDismiss: (entry: AttentionEntry) => void; attentionOpen: boolean; toggleAttention: () => void }) {
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
  return <ReadyContent view={state.view} styles={styles} selectedAgentId={selectedAgentId} selectAgent={selectAgent} loadMore={loadMore} timeline={state.timeline ?? {}} attention={state.attention} onDismiss={onDismiss} attentionOpen={attentionOpen} toggleAttention={toggleAttention} />;
}

function ReadyContent({ view, styles, selectedAgentId, selectAgent, loadMore, timeline, attention, onDismiss, attentionOpen, toggleAttention }: { view: ObservatoryViewModel; styles: PanelStyles; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void; timeline: Record<string, { entries: { label: string; summary: string; at: string }[]; error?: string; hasOlder: boolean }>; attention: AttentionEntry[]; onDismiss: (entry: AttentionEntry) => void; attentionOpen: boolean; toggleAttention: () => void }) {
  const agentCount = view.workspaces.reduce((total, workspace) => total + workspace.agents.length, 0);
  const titles = new Map(view.workspaces.flatMap((workspace) => workspace.agents.map((agent) => [agent.id, agent.title] as const)));
  return (
    <>
       <Text style={styles.subtitle}>Project: {view.project.name}</Text>
       <Text style={styles.subtitle}>Project-wide token usage across active workspaces.</Text>
       <Text style={styles.label}>{view.workspaces.length} workspaces · {agentCount} agents</Text>
       <DashboardSummary dashboard={view.dashboard} styles={styles} />
      <View accessibilityLabel="Agent lifecycle summary" style={styles.summary}>
        {view.counts.map(({ label, count }) => (
          <View key={label} accessibilityLabel={`${label}: ${count}`}>
            <Text style={styles.count}>{count}</Text>
            <Text style={styles.label}>{label}</Text>
          </View>
        ))}
      </View>
       <AttentionQueue attention={attention} titles={titles} styles={styles} selectAgent={selectAgent} onDismiss={onDismiss} expanded={attentionOpen} onToggle={toggleAttention} />
       <ModelUsagePanel models={view.models} styles={styles} />
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Workspaces
      </Text>
      {agentCount === 0 ? (
        <Text style={styles.subtitle}>No agents are currently available in this project.</Text>
      ) : null}
       <View accessibilityLabel="Delegation analysis" style={styles.analysisRow}>
         <View accessibilityLabel="Delegation tree" style={styles.treePanel}>
           <Text accessibilityRole="header" style={styles.sectionTitle}>Delegation tree</Text>
           {view.dashboard.agents.length === 0 ? <Text style={styles.subtitle}>No agents</Text> : view.dashboard.agents.map((agent) => (
             <Pressable key={agent.id} onPress={() => selectAgent(agent.id)} accessibilityRole="button" accessibilityLabel={`${agent.title}, ${agent.model ?? "model unknown"}, ${agent.usage.finalizedTurnCount} finalized turns, ${agent.lifecycle}, depth ${agent.depth}`} style={[styles.row, agent.id === selectedAgentId ? styles.agentPressable : undefined]}>
               <Text style={[styles.agentTitle, { marginLeft: agent.depth * 12 }]}>{agent.title}</Text>
               <Text style={styles.status}>{agent.model ?? "Model unknown"} · {agent.usage.recordedTokens.toLocaleString()} finalized tokens · {agent.lifecycle}</Text>
             </Pressable>
           ))}
         </View>
         <View accessibilityLabel="Selected agent usage" style={styles.detailPanel}>
           <Text accessibilityRole="header" style={styles.sectionTitle}>Selected agent usage</Text>
           {selectedAgentId ? (() => { const agent = view.dashboard.agents.find((item) => item.id === selectedAgentId); const workspace = view.workspaces.flatMap((item) => item.agents).find((item) => item.id === selectedAgentId); const maxTokens = finalizedTurnScale(workspace?.usageTurns ?? []); return agent && workspace ? <AgentUsageDetail workspaceName={agent.workspaceName} model={workspace.model} finalizedTokens={agent.usage.recordedTokens} costState={agent.usage.costState} turns={workspace.usageTurns} switchedModels={workspace.switchedModels} styles={styles} maxTokens={maxTokens} /> : <Text style={styles.subtitle}>Select an agent.</Text>; })() : <Text style={styles.subtitle}>Select an agent.</Text>}
           {selectedAgentId && timeline[selectedAgentId] ? <ActivityDetail timeline={timeline[selectedAgentId]} onLoadMore={() => loadMore(selectedAgentId)} styles={styles} /> : null}
         </View>
       </View>
    </>
  );
}

interface TimelineSummaryView {
  entries: { label: string; summary: string; at: string }[];
  error?: string;
  hasOlder: boolean;
}

function ActivityDetail({ timeline, onLoadMore, styles }: { timeline: TimelineSummaryView; onLoadMore: () => void; styles: PanelStyles }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Activity</Text>
      {timeline.error ? <Text style={styles.error}>{timeline.error}</Text> : null}
      {timeline.entries.map((entry, index) => (
        <Text key={`${entry.at}-${index}`} style={styles.status}>
          {entry.label}: {entry.summary}
        </Text>
      ))}
      {timeline.hasOlder ? (
        <Pressable onPress={onLoadMore}>
          <Text style={styles.label}>Load more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DashboardSummary({ dashboard, styles }: { dashboard: ObservatoryViewModel["dashboard"]; styles: PanelStyles }) {
  const cards = [
    ["Recorded tokens", dashboard.recordedTokens.toLocaleString(), `${dashboard.finalizedTurnCount} finalized turns`],
    ["Cached input", dashboard.cachedInputTokens.toLocaleString(), `${dashboard.inputTokens ? Math.round((dashboard.cachedInputTokens / dashboard.inputTokens) * 100) : 0}% of input`],
    ["Reported cost", dashboard.reportedCostUsd === null ? "Unknown" : `$${dashboard.reportedCostUsd.toFixed(4)}`, dashboard.costState === "complete" ? "Complete" : dashboard.costState === "partial" ? "Partial reporting" : "No cost reported"],
    ["Working agents", dashboard.workingAgentCount.toLocaleString(), "Active or waiting"],
  ];
  return <View accessibilityLabel="Usage summary" style={styles.summary}>{cards.map(([label, value, support]) => <View key={label} style={styles.card} accessibilityLabel={`${label}: ${value}. ${support}`}><Text style={styles.count}>{value}</Text><Text style={styles.label}>{label}</Text><Text style={styles.label}>{support}</Text></View>)}</View>;
}

function ModelUsagePanel({ models, styles }: { models: ModelUsageBar[]; styles: PanelStyles }) {
  const maximum = Math.max(...models.map((bar) => bar.totalTokens), 1);
  return <View style={styles.usageSection}><Text accessibilityRole="header" style={styles.sectionTitle}>Usage by model</Text><View style={styles.legend}><View style={styles.legendItem}><View style={styles.legendSwatchFresh} /><Text style={styles.label}>Fresh</Text></View><View style={styles.legendItem}><View style={styles.legendSwatchCached} /><Text style={styles.label}>Cached</Text></View><View style={styles.legendItem}><View style={styles.legendSwatchOutput} /><Text style={styles.label}>Output</Text></View></View>{models.length === 0 ? <Text style={styles.subtitle}>No finalized usage reported yet.</Text> : models.map((bar) => <ModelBar key={bar.model} bar={bar} maximum={maximum} styles={styles} />)}</View>;
}

function ModelBar({ bar, maximum, styles }: { bar: ModelUsageBar; maximum: number; styles: PanelStyles }) {
  const total = Math.max(bar.totalTokens, 1);
  return (
    <View
      accessibilityLabel={modelUsageAccessibilityLabel(bar)}
      style={styles.barRow}
    >
      <View style={styles.barHeader}>
         <Text style={styles.modelName}>{bar.model} · {bar.provider ?? "Provider unknown"} · {bar.costState === "unknown" ? "Cost unknown" : bar.costState === "partial" ? "Cost partial" : `$${bar.reportedCostUsd?.toFixed(4)}`}</Text>
        <Text style={styles.tokenTotal}>{bar.totalTokens.toLocaleString()} tokens</Text>
      </View>
       <View accessibilityLabel={`${bar.model} token composition: fresh input ${bar.freshInputTokens}, cached input ${bar.cachedInputTokens}, output ${bar.outputTokens}`} style={[styles.barTrack, { width: `${(bar.totalTokens / maximum) * 100}%` }]}>
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
  finalizedTokens,
  costState,
  turns,
  switchedModels,
  styles,
  maxTokens,
}: {
  workspaceName: string;
  model: string | null;
  finalizedTokens: number;
  costState: "complete" | "partial" | "unknown";
  turns: ObservatoryAgentUsageTurn[];
  switchedModels: boolean;
  maxTokens?: number;
  styles: PanelStyles;
}) {
  const finalized = turns.filter((turn) => !turn.provisional);
  const provisional = turns.find((turn) => turn.provisional);
  return (
    <View>
      <Text style={styles.detailLine}>Workspace: {workspaceName}</Text>
      {model ? <Text style={styles.detailLine}>Current model: {model}</Text> : null}
      <Text style={styles.detailLine}>Finalized tokens: {finalizedTokens.toLocaleString()}</Text>
      <Text style={styles.detailLine}>Cost state: {costState}</Text>
      {switchedModels ? <Text style={styles.detailLine}>⇄ Model switched across turns</Text> : null}
      {finalized.length === 0 && !provisional ? (
        <Text style={styles.detailLine}>No reported turn usage.</Text>
      ) : null}
      {turns.length > 0 ? (
        <ScrollView horizontal contentContainerStyle={{ minWidth: Math.max(280, (turns.length || 1) * 56) }} showsHorizontalScrollIndicator={true}>
        <View style={styles.turnRow} accessibilityLabel="Per-turn token usage">
          {turns.map((turn, index) => (
            <TurnColumn key={`${turn.turnId ?? "unknown"}-${index}`} turn={turn} styles={styles} maxTokens={maxTokens} />
          ))}
        </View>
        </ScrollView>
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

function TurnColumn({ turn, styles, maxTokens }: { turn: ObservatoryAgentUsageTurn; styles: PanelStyles; maxTokens?: number }) {
  const input = turn.inputTokens ?? 0;
  const cached = Math.min(turn.cachedInputTokens ?? 0, input);
  const fresh = Math.max(0, input - cached);
  const output = turn.outputTokens ?? 0;
  const total = Math.max(input + output, 1);
  const scale = Math.max(maxTokens ?? total, 1);
  return (
    <View
      style={styles.turnColumn}
      accessibilityLabel={
        `${turn.provisional ? "Live turn" : "Turn"}${turn.model ? `, model ${turn.model}` : ""}: ` +
        `${input + output} tokens`
      }
    >
       <View style={[styles.turnStack, { height: turnBarHeight(turn, scale) }]}>
        <View style={{ flex: (fresh / total) || 0, ...styles.segmentFresh }} />
        <View style={{ flex: (cached / total) || 0, ...styles.segmentCached }} />
        <View style={{ flex: (output / total) || 0, ...styles.segmentOutput }} />
      </View>
      <Text style={styles.provisionalLabel}>{turn.provisional ? "live" : (turn.model ?? "?")}</Text>
    </View>
  );
}


