import { type PluginWorkspacePanelProps, usePaseo, useRpc } from "@getpaseo/plugin";
import React, { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type DimensionValue, type TextStyle, type ViewStyle } from "react-native";
import { ATTENTION_REASON_LABELS, finalizedTurnScale, selectedAgentAfterProjection, turnBarHeight, type AgentLifecycle, type AttentionEntry, type AttentionReasonKind, type ModelUsageBar, type ObservatoryAgentUsageTurn } from "./observation";
import type { ObservatoryViewModel } from "./observation";
import {
  ProjectObservationController,
  type ProjectObservationState,
  type TelemetryDiagnostic,
} from "./project-observation";
import { observatoryDismissalContracts, type AttentionDismissalRecord } from "./dismissals";
import { observatoryUsageContracts, type HistoricalUsageProjection, type UsageTurnStore } from "./usage-turns";
import { lifecycleStyle, modelUsageAccessibilityLabel, observatoryLayout, selectedAgentMetadata, turnAccessibilityLabel, turnDisplayLabel, usageChartPalette } from "./accessibility";
import { historySourceLabel, prepareSanitizedUsageExport, projectHistoryForRange, USAGE_RANGE_LABELS } from "./usage-history";
import type { NormalizedUsageTurn, UsageRange } from "./usage-turns";

export function AgentObservatoryPanel({
  theme,
  layout,
  workspaceId,
}: PluginWorkspacePanelProps) {
  const paseo = usePaseo();
  const { width } = useWindowDimensions();
  const responsiveLayout = observatoryLayout(width, layout.compact);
  const isCompact = responsiveLayout === "compact";
  const getDismissals = useRpc(observatoryDismissalContracts.get);
  const putDismissal = useRpc(observatoryDismissalContracts.put);
  const removeAgentsDismissal = useRpc(observatoryDismissalContracts.removeAgents);
  const getUsage = useRpc(observatoryUsageContracts.get);
  const putUsage = useRpc(observatoryUsageContracts.put);
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
    () => {
      const usageStore: UsageTurnStore = {
        get: async (scope) => (await getUsage(scope)).turns,
        put: async (turn) => (await putUsage({ turn })).turns,
      };
      return new ProjectObservationController(paseo, workspaceId, undefined, undefined, dismissalApi, usageStore);
    },
    [paseo, workspaceId, dismissalApi, getUsage, putUsage],
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
  const [historyRange, setHistoryRange] = React.useState<UsageRange>("24h");
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
        padding: isCompact ? 16 : 24,
        gap: isCompact ? 12 : 18,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: isCompact ? 24 : 32,
        fontWeight: "700" as const,
      },
      headerRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      searchInput: {
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 6,
        height: 24,
        paddingHorizontal: 8,
        paddingVertical: 0,
        width: isCompact ? 150 : 220,
      },
      filterLine: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.foregroundMuted,
      },
      subtitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
      },
      summary: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: isCompact ? 12 : 20,
      },
      card: {
        flexGrow: 1,
        flexBasis: isCompact ? ("100%" as DimensionValue) : responsiveLayout === "medium" ? ("46%" as DimensionValue) : ("21%" as DimensionValue),
        minWidth: isCompact ? ("100%" as DimensionValue) : 130,
        padding: 14,
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        gap: 4,
      },
      count: {
        color: theme.colors.foreground,
        fontSize: isCompact ? 20 : 24,
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
        paddingHorizontal: 8,
        borderBottomWidth: 0.5,
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
      agentModel: {
        color: theme.colors.foregroundMuted,
        fontFamily: "monospace",
        fontSize: 12,
      },
      lifecycleActive: { color: theme.colors.accent, fontWeight: "600" as const },
      lifecycleWaiting: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      lifecycleFailed: { color: theme.colors.statusDanger, fontWeight: "600" as const },
      lifecycleFinished: { color: theme.colors.foregroundMuted, fontWeight: "600" as const },
      lifecycleOther: { color: theme.colors.foreground, fontWeight: "600" as const },
      rowActive: { borderBottomColor: theme.colors.accent },
      rowWaiting: { borderBottomColor: theme.colors.accentForeground },
      rowFinished: { borderBottomColor: theme.colors.foregroundMuted },
      rowFailed: { borderBottomColor: theme.colors.statusDanger },
      rowOther: { borderBottomColor: theme.colors.foreground },
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
      historyCard: { gap: 12, padding: layout.compact ? 12 : 16, borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 10 },
      chartRow: { flexDirection: "row" as const, gap: 16, minHeight: layout.compact ? 180 : 230 },
      chartPanel: { flex: 1, gap: 8, minWidth: 0 },
      chartPlot: { flex: 1, flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 2, minHeight: 130, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: theme.colors.foregroundMuted, paddingHorizontal: 4 },
      chartBar: { flex: 1, justifyContent: "flex-end" as const, alignItems: "stretch" as const, maxWidth: 18 },
      chartSegment: { minHeight: 1 },
      linePlot: { flex: 1, minHeight: 130, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: theme.colors.foregroundMuted, position: "relative" as const },
      chartLine: { position: "absolute" as const, height: 2 },
      chartAxis: { flexDirection: "row" as const, justifyContent: "space-between" as const },
      rangeTabs: { flexDirection: "row" as const, gap: 6 },
      rangeTab: { borderWidth: 1, borderColor: theme.colors.foregroundMuted, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
      rangeTabActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
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
        backgroundColor: usageChartPalette(theme.colors).fresh,
      },
      segmentCached: {
        backgroundColor: usageChartPalette(theme.colors).cached,
      },
      segmentOutput: { backgroundColor: usageChartPalette(theme.colors).output },
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
        backgroundColor: usageChartPalette(theme.colors).fresh,
      },
      legendSwatchCached: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: usageChartPalette(theme.colors).cached,
      },
      legendSwatchOutput: {
        width: 10,
        height: 10,
        borderRadius: 2,
        backgroundColor: usageChartPalette(theme.colors).output,
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
        flexDirection: isCompact ? "column" as const : "row" as const,
        gap: isCompact ? 12 : 18,
      },
      treePanel: {
        flex: isCompact ? undefined : 1,
        flexBasis: isCompact ? undefined : ("33%" as DimensionValue),
        borderWidth: 1,
        borderColor: theme.colors.foregroundMuted,
        borderRadius: 10,
        padding: 12,
        gap: 4,
      },
      detailPanel: {
        flex: isCompact ? undefined : 2,
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
      touchTarget: {
        minHeight: 44,
        justifyContent: "center" as const,
      },
    }),
    [isCompact, responsiveLayout, theme],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 }}>TOKEN USAGE</Text>
      <View style={styles.headerRow}>
        <Text accessibilityRole="header" style={styles.title}>Agent Observatory</Text>
        <TextInput accessibilityLabel="Search workspaces or agents" placeholder="Search" value={query} onChangeText={setQuery} style={styles.searchInput} />
      </View>
      <StateContent state={state} styles={styles} lifecycle={lifecycle} setLifecycle={setLifecycle} selectedAgentId={selectedAgentId} selectAgent={(id) => { setSelectedAgentId(id || null); if (id) void controller.loadTimeline(id); }} loadMore={(id) => void controller.loadTimeline(id, true)} onDismiss={(entry) => void controller.dismissAttention(entry)} attentionOpen={attentionOpen} toggleAttention={() => setAttentionOpen(!attentionOpen)} historyRange={historyRange} setHistoryRange={setHistoryRange} />
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
  agentModel: TextStyle;
  lifecycleActive: TextStyle;
  lifecycleWaiting: TextStyle;
  lifecycleFailed: TextStyle;
  lifecycleFinished: TextStyle;
  lifecycleOther: TextStyle;
  rowActive: ViewStyle;
  rowWaiting: ViewStyle;
  rowFinished: ViewStyle;
  rowFailed: ViewStyle;
  rowOther: ViewStyle;
  attentionRow: ViewStyle;
  reasonUserInput: TextStyle;
  reasonFailure: TextStyle;
  reasonInactivity: TextStyle;
  workspaceBadge: TextStyle;
  error: TextStyle;
  usageSection: ViewStyle;
  historyCard: ViewStyle;
  chartRow: ViewStyle;
  chartPanel: ViewStyle;
  chartPlot: ViewStyle;
  chartBar: ViewStyle;
  chartSegment: ViewStyle;
  linePlot: ViewStyle;
  chartLine: ViewStyle;
  chartAxis: ViewStyle;
  rangeTabs: ViewStyle;
  rangeTab: ViewStyle;
  rangeTabActive: ViewStyle;
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
  headerRow: ViewStyle;
  searchInput: TextStyle;
  filterLine: ViewStyle;
  control: TextStyle;
  touchTarget: ViewStyle;
}

const ATTENTION_REASON_STYLES: Record<AttentionReasonKind, keyof PanelStyles> = {
  user_input: "reasonUserInput",
  failure: "reasonFailure",
  inactivity: "reasonInactivity",
};

const LIFECYCLE_TEXT_STYLES: Record<AgentLifecycle, keyof PanelStyles> = {
  active: "lifecycleActive",
  waiting: "lifecycleWaiting",
  finished: "lifecycleFinished",
  failed: "lifecycleFailed",
  other: "lifecycleOther",
};

const LIFECYCLE_ROW_STYLES: Record<AgentLifecycle, keyof PanelStyles> = {
  active: "rowActive",
  waiting: "rowWaiting",
  finished: "rowFinished",
  failed: "rowFailed",
  other: "rowOther",
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
           style={[styles.attentionRow, styles.touchTarget]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={styles[ATTENTION_REASON_STYLES[entry.reason]]}>{ATTENTION_REASON_LABELS[entry.reason]}</Text>
            <Text style={styles.workspaceBadge}>{entry.workspaceName}</Text>
          </View>
          <Text style={styles.agentTitle}>{titles.get(entry.agentId) ?? entry.agentId}</Text>
          <Pressable
            onPress={() => onDismiss(entry)}
            accessibilityLabel={`Dismiss ${ATTENTION_REASON_LABELS[entry.reason]} for ${titles.get(entry.agentId) ?? entry.agentId}`}
             style={[styles.dismissButton, styles.touchTarget]}
          >
            <Text style={styles.dismissLabel}>Dismiss</Text>
          </Pressable>
        </Pressable>
      )) : null}
    </View>
  );
}

function StateContent({ state, styles, lifecycle, setLifecycle, selectedAgentId, selectAgent, loadMore, onDismiss, attentionOpen, toggleAttention, historyRange, setHistoryRange }: { state: ProjectObservationState; styles: PanelStyles; lifecycle?: AgentLifecycle; setLifecycle: (value: AgentLifecycle | undefined) => void; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void; onDismiss: (entry: AttentionEntry) => void; attentionOpen: boolean; toggleAttention: () => void; historyRange: UsageRange; setHistoryRange: (range: UsageRange) => void }) {
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
  return <ReadyContent view={state.view} historicalUsage={state.historicalUsage} styles={styles} telemetry={state.telemetry} lifecycle={lifecycle} setLifecycle={setLifecycle} selectedAgentId={selectedAgentId} selectAgent={selectAgent} loadMore={loadMore} timeline={state.timeline ?? {}} attention={state.attention} onDismiss={onDismiss} attentionOpen={attentionOpen} toggleAttention={toggleAttention} historyRange={historyRange} setHistoryRange={setHistoryRange} />;
}

function ReadyContent({ view, historicalUsage, styles, telemetry, lifecycle, setLifecycle, selectedAgentId, selectAgent, loadMore, timeline, attention, onDismiss, attentionOpen, toggleAttention, historyRange, setHistoryRange }: { view: ObservatoryViewModel; historicalUsage?: Record<UsageRange, HistoricalUsageProjection>; styles: PanelStyles; telemetry?: TelemetryDiagnostic; lifecycle?: AgentLifecycle; setLifecycle: (value: AgentLifecycle | undefined) => void; selectedAgentId: string | null; selectAgent: (id: string) => void; loadMore: (id: string) => void; timeline: Record<string, { entries: { label: string; summary: string; at: string }[]; error?: string; hasOlder: boolean }>; attention: AttentionEntry[]; onDismiss: (entry: AttentionEntry) => void; attentionOpen: boolean; toggleAttention: () => void; historyRange: UsageRange; setHistoryRange: (range: UsageRange) => void }) {
  const agentCount = view.workspaces.reduce((total, workspace) => total + workspace.agents.length, 0);
  const titles = new Map(view.workspaces.flatMap((workspace) => workspace.agents.map((agent) => [agent.id, agent.title] as const)));
  const historyTurns = view.workspaces.flatMap((workspace) => workspace.agents.flatMap((agent) => agent.usageTurns.filter((turn) => !turn.provisional && turn.observedAt).map((turn): NormalizedUsageTurn => ({ projectId: view.project.id, workspaceId: workspace.id, agentId: agent.id, turnId: turn.turnId ?? `${agent.id}-${turn.observedAt}`, observedAt: turn.observedAt!, startedAt: turn.startedAt ?? null, completedAt: turn.completedAt ?? null, model: turn.model ?? agent.model, inputTokens: turn.inputTokens, cachedInputTokens: turn.cachedInputTokens, outputTokens: turn.outputTokens, contextUsedTokens: turn.contextUsedTokens, contextMaxTokens: turn.contextMaxTokens, costUsd: turn.costUsd, costState: turn.costUsd === null ? "unknown" : "complete", confidence: "high" }))));
  const history = historicalUsage?.[historyRange] ?? projectHistoryForRange(historyTurns, historyRange, Date.now());
  const [exported, setExported] = React.useState<string | null>(null);
  return (
    <>
       <Text style={styles.subtitle}>Project: {view.project.name}</Text>
       <Text style={styles.subtitle}>Project-wide token usage across active workspaces.</Text>
       <Text style={styles.label}>{view.workspaces.length} workspaces · {agentCount} agents</Text>
       <DashboardSummary dashboard={view.dashboard} historicalUsage={historicalUsage} styles={styles} />
       <HistoryCharts history={history} range={historyRange} onRangeChange={setHistoryRange} styles={styles} exportValue={exported} onExport={() => { const result = prepareSanitizedUsageExport(history.turns); setExported(result.data ?? result.error ?? "Export failed; try again."); }} />
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
       <Text style={styles.label}>Telemetry: {telemetry ? `${telemetry.type} · usage ${telemetry.usagePresent ? "received" : "not reported"} · fields: ${telemetry.usageFields.join(", ") || "none"}` : "waiting for an agent event"}</Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Workspaces
      </Text>
      {agentCount === 0 ? (
        <Text style={styles.subtitle}>No agents are currently available in this project.</Text>
      ) : null}
       <View accessibilityLabel="Delegation analysis" style={styles.analysisRow}>
          <View accessibilityLabel="Delegation tree" style={styles.treePanel}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>Delegation tree</Text>
            <View accessibilityLabel="Agent lifecycle filters" style={styles.filterLine}>{(["active", "waiting", "finished", "failed", "other"] as AgentLifecycle[]).map(value => <Pressable key={value} style={styles.touchTarget} accessibilityRole="checkbox" accessibilityState={{ checked: lifecycle === value }} onPress={() => setLifecycle(lifecycle === value ? undefined : value)}><Text style={styles.label}>{lifecycle === value ? `✓ ${value}` : value}</Text></Pressable>)}</View>
           {view.dashboard.agents.length === 0 ? <Text style={styles.subtitle}>No agents</Text> : view.dashboard.agents.map((agent) => (
              <Pressable key={agent.id} onPress={() => selectAgent(agent.id)} accessibilityRole="button" accessibilityLabel={`${agent.title}, ${agent.model ?? "model unknown"}, ${agent.usage.finalizedTurnCount} finalized turns, ${agent.lifecycle}, depth ${agent.depth}`} style={[styles.row, styles[LIFECYCLE_ROW_STYLES[agent.lifecycle]], styles.touchTarget, agent.id === selectedAgentId ? styles.agentPressable : undefined]}>
                <Text style={[styles.agentTitle, styles[LIFECYCLE_TEXT_STYLES[lifecycleStyle(agent.lifecycle)]], { marginLeft: agent.depth * 12 }]}>{agent.title}</Text>
                <Text style={styles.status}><Text style={styles.agentModel}>{agent.model ?? "Model unknown"}</Text> · {agent.usage.recordedTokens.toLocaleString()} finalized tokens · <Text style={styles[LIFECYCLE_TEXT_STYLES[lifecycleStyle(agent.lifecycle)]]}>{agent.lifecycle}</Text></Text>
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
        <Pressable onPress={onLoadMore} style={styles.touchTarget} accessibilityRole="button" accessibilityLabel="Load older activity">
          <Text style={styles.label}>Load more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DashboardSummary({ dashboard, historicalUsage, styles }: { dashboard: ObservatoryViewModel["dashboard"]; historicalUsage?: Record<UsageRange, HistoricalUsageProjection>; styles: PanelStyles }) {
  const cards = [
    ["Recorded tokens", dashboard.recordedTokens.toLocaleString(), `${dashboard.finalizedTurnCount} finalized turns`],
    ["Cached input", dashboard.cachedInputTokens.toLocaleString(), `${dashboard.inputTokens ? Math.round((dashboard.cachedInputTokens / dashboard.inputTokens) * 100) : 0}% of input`],
    ["Reported cost", dashboard.reportedCostUsd === null ? "Unknown" : `$${dashboard.reportedCostUsd.toFixed(4)}`, dashboard.costState === "complete" ? "Complete" : dashboard.costState === "partial" ? "Partial reporting" : "No cost reported"],
    ["Working agents", dashboard.workingAgentCount.toLocaleString(), "Active or waiting"],
  ];
  const history = historicalUsage?.["30d"];
  if (history) cards.push(["30d recorded", history.recordedTokens.toLocaleString(), `${history.turns.length} persisted turns`]);
  return <View accessibilityLabel="Usage summary" style={styles.summary}>{cards.map(([label, value, support]) => <View key={label} style={styles.card} accessibilityLabel={`${label}: ${value}. ${support}`}><Text style={styles.count}>{value}</Text><Text style={styles.label}>{label}</Text><Text style={styles.label}>{support}</Text></View>)}</View>;
}

function HistoryCharts({ history, range, onRangeChange, styles, exportValue, onExport }: { history: HistoricalUsageProjection; range: UsageRange; onRangeChange: (range: UsageRange) => void; styles: PanelStyles; exportValue: string | null; onExport: () => void }) {
  const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const bucketMs = range === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: bucketCount }, () => ({ fresh: 0, cached: 0, output: 0 }));
  for (const turn of history.turns) {
    const at = Date.parse(turn.completedAt ?? turn.startedAt ?? turn.observedAt);
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((history.to - at) / bucketMs)));
    const bucket = buckets[bucketCount - 1 - index];
    const input = turn.inputTokens ?? 0;
    bucket.cached += Math.min(input, turn.cachedInputTokens ?? 0);
    bucket.fresh += Math.max(0, input - (turn.cachedInputTokens ?? 0));
    bucket.output += turn.outputTokens ?? 0;
  }
  const maxBar = Math.max(1, ...buckets.map((bucket) => bucket.fresh + bucket.cached + bucket.output));
  const cumulative = { fresh: 0, cached: 0, output: 0 };
  const lines = buckets.map((bucket) => { cumulative.fresh += bucket.fresh; cumulative.cached += bucket.cached; cumulative.output += bucket.output; return { ...cumulative }; });
  const maxLine = Math.max(1, ...lines.flatMap((point) => [point.fresh, point.cached, point.output]));
  const palette = { fresh: "#93b4f4", cached: "#f3f4f6", output: "#d99b91" };
  const lineSegments = (key: "fresh" | "cached" | "output", color: string) => lines.slice(1).map((point, index) => { const previous = lines[index][key] / maxLine; const current = point[key] / maxLine; const dx = 100 / bucketCount; const dy = (previous - current) * 130; const length = Math.sqrt(dx * dx + dy * dy); const angle = Math.atan2(dy, dx) * 180 / Math.PI; return <View key={`${key}-${index}`} style={[styles.chartLine, { backgroundColor: color, left: `${(index + 0.5) * dx}%`, top: `${(1 - previous) * 100}%`, width: `${length}%`, transform: [{ rotate: `${angle}deg` }] }]} />; });
  return <View accessibilityLabel={`${USAGE_RANGE_LABELS[range]} usage charts`} style={styles.historyCard}><View style={styles.headerRow}><View><Text accessibilityRole="header" style={styles.sectionTitle}>Usage history</Text><Text style={styles.label}>{historySourceLabel(history)} · {history.recordedTokens.toLocaleString()} recorded tokens</Text></View><View style={styles.rangeTabs}>{(Object.keys(USAGE_RANGE_LABELS) as UsageRange[]).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: range === value }} onPress={() => onRangeChange(value)} style={[styles.rangeTab, range === value ? styles.rangeTabActive : undefined]}><Text style={range === value ? styles.dismissLabel : styles.label}>{USAGE_RANGE_LABELS[value]}</Text></Pressable>)}</View></View><View style={styles.chartRow}><View style={styles.chartPanel}><Text style={styles.label}>Tokens per {range === "24h" ? "hour" : "day"}</Text><View style={styles.chartPlot}>{buckets.map((bucket, index) => <View key={index} style={styles.chartBar}><View style={[styles.chartSegment, { height: `${bucket.output / maxBar * 100}%` }, styles.segmentOutput]} /><View style={[styles.chartSegment, { height: `${bucket.cached / maxBar * 100}%` }, styles.segmentCached]} /><View style={[styles.chartSegment, { height: `${bucket.fresh / maxBar * 100}%` }, styles.segmentFresh]} /></View>)}</View></View><View style={styles.chartPanel}><Text style={styles.label}>Cumulative fresh / cached / output</Text><View style={styles.linePlot}>{lineSegments("fresh", palette.fresh)}{lineSegments("cached", palette.cached)}{lineSegments("output", palette.output)}</View><View style={styles.chartAxis}><Text style={styles.label}>Start</Text><Text style={styles.label}>Now</Text></View></View></View><Pressable accessibilityRole="button" onPress={onExport} style={styles.touchTarget}><Text style={styles.label}>Prepare sanitized history for copying</Text></Pressable>{exportValue ? <Text selectable style={styles.label}>{exportValue}</Text> : null}</View>;
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
      <Text accessibilityLabel={selectedAgentMetadata({ workspaceName, model, finalizedTokens, costState, switchedModels })} style={styles.detailLine}>{selectedAgentMetadata({ workspaceName, model, finalizedTokens, costState, switchedModels })}</Text>
      {finalized.length === 0 && !provisional ? (
        <Text style={styles.detailLine}>No reported turn usage.</Text>
      ) : null}
      {turns.length > 0 ? (
        <ScrollView horizontal accessibilityLabel="Per-turn token usage, scroll horizontally for more turns" contentContainerStyle={{ minWidth: Math.max(280, (turns.length || 1) * 56) }} showsHorizontalScrollIndicator={true}>
        <View style={styles.turnRow}>
          {turns.map((turn, index) => (
            <TurnColumn key={`${turn.turnId ?? "unknown"}-${index}`} turn={turn} index={index} styles={styles} maxTokens={maxTokens} />
          ))}
        </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

function TurnColumn({ turn, styles, maxTokens, index }: { turn: ObservatoryAgentUsageTurn; styles: PanelStyles; maxTokens?: number; index: number }) {
  const input = turn.inputTokens ?? 0;
  const cached = Math.min(turn.cachedInputTokens ?? 0, input);
  const fresh = Math.max(0, input - cached);
  const output = turn.outputTokens ?? 0;
  const total = Math.max(input + output, 1);
  const scale = Math.max(maxTokens ?? total, 1);
  return (
    <View
      style={styles.turnColumn}
      accessibilityLabel={turnAccessibilityLabel(turn)}
    >
       <View style={[styles.turnStack, { height: turnBarHeight(turn, scale) }]}>
        <View style={{ flex: (fresh / total) || 0, ...styles.segmentFresh }} />
        <View style={{ flex: (cached / total) || 0, ...styles.segmentCached }} />
        <View style={{ flex: (output / total) || 0, ...styles.segmentOutput }} />
      </View>
      <Text style={styles.provisionalLabel}>{turnDisplayLabel(turn, index)}</Text>
    </View>
  );
}


