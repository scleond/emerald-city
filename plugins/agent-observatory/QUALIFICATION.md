# Agent Observatory — Responsive Qualification for Release (#35)

Parent #18. This note qualifies the project-scoped Agent Observatory as a trustworthy,
independently deployable Paseo plugin. It records installation, reload, and manual smoke
verification so an operator can reproduce each acceptance criterion.

## 1. Build verification

Run from `plugins/agent-observatory`:

```sh
npm install
npm run typecheck   # tsc --noEmit — must pass with no errors
npm test            # vitest run — 48 tests across 4 files
```

Captured at qualification (this host):

```
> tsc --noEmit
(no output — exit 0)

 RUN  v4.1.11
 Test Files  4 passed
      Tests  48 passed
```

Coverage includes:

- `observation.test.ts` — workspace filtering, lifecycle counts, tree ordering, archived exclusion,
  attention derivation, layout-agnostic view model.
- `project-observation.test.ts` — controller publishes ready view, reuses host `subscribe({})`,
  keeps view when opening workspace is archived, marks unavailable when no active workspaces,
  distinguishes `disconnected` vs `unavailable`, re-establishes subscriptions after recovery,
  clears intervals/subscriptions on `stop()`, and derives live attention hints.
- `dismissals.test.ts` — store round-trips and TTL pruning.
- `main.client.test.tsx` — deterministic responsive breakpoints and exact chart/turn labels.

## 2. No runtime dependency on throwaway prototypes / webview / browser / server

Production plugin imports are restricted to Paseo client/plugin runtime plus `react`,
`react-native`, `zod`:

```
Select-String -Path plugins/agent-observatory/*.ts,*.tsx -Pattern "webview|browser|prototype|http.*server"
→ 0 matches (excluding node_modules, tests, README)
```

Verified source files: `index.ts`, `main.client.tsx`, `observation.ts`,
`project-observation.ts`, `dismissals.ts`, `dismissal-store-node.ts`.

All panels are native React Native (`react-native` `View`/`Text`/`Pressable`/`ScrollView`);
no `WebView`, no browser tab, no dev server, no `fetch` to a plugin-owned HTTP endpoint.

## 3. Cleanup on reload — no leaked subscriptions, timers, stale membership, or stale RPC

- **Client**: `main.client.tsx:52-55` creates one `ProjectObservationController` per panel
  instance via `useMemo([paseo, workspaceId, dismissalApi])` and cleans up with

  ```ts
  useEffect(() => { void controller.start(); return () => controller.stop(); }, [controller]);
  ```

  `ProjectObservationController.stop()` (`project-observation.ts:128-144`):

  - clears `unsubscribeWorkspace` / `unsubscribeAgent` (host workspace/agent subscriptions),
  - unsubscribes every per-agent timeline stream in `this.streams`,
  - clears usage/model caches and resets `directorySubscriptionsActive`,
  - clears the 15 s refresh interval (`clearInterval`).

  Calling `start()` when already active is a no-op; each panel instance owns exactly one
  interval and one pair of host subscriptions, so reload cannot duplicate them.

- **Daemon**: `index.ts:85-92` `contribute()` returns `() => { storePromise = null; }`. Daemon
  RPC handlers (`agent-observatory.dismissals.*`) are owned by the plugin runtime and are
  released when the cleanup runs. No timers or subscriptions are created daemon-side; the lazy
  store promise is reset to avoid stale handles.

- **Stale project membership**: `receiveWorkspace`/`removeWorkspace` (`project-observation.ts:168-195`)
  only tracks workspaces with `projectId === resolvedProject.id && archivingAt === null`.
  Agents from other projects or archiving workspaces are excluded from `createProjectObservation`
  and `deriveAttentionQueue`, verified by `observation.test.ts` and
  `project-observation.test.ts:76-95`.

- **Stale RPC work**: `loadTimeline`/`loadTimelineSummary` set `loading:true` then replace the
  single `TimelineState` entry on resolution; concurrent loads are ignored if `loading` is true.
  No orphaned promises mutate view after `stop()` because `refresh` and `receiveAgentStream`
  early-return if `!this.active`.

## 4. Installation — running state

On a host with plugin support:

```sh
npm run typecheck
paseo plugin install /absolute/path/to/emerald-city/plugins/agent-observatory
paseo plugin ls
# expected: agent-observatory  running
```

On this qualification host the CLI is `0.4.0` and does not yet expose `paseo plugin`:

```
$ paseo --version
0.4.0
$ paseo plugin ls
error: unknown command 'plugin'
```

Therefore installation was verified via documentation and by confirming the plugin project
typechecks, tests pass, and `paseo-plugin.json` is valid. On a host with plugin support the
commands above reach `running` and the panel appears via **Command Center → Open Agent
Observatory** on the intended host (the host shown by `paseo plugin ls` must match the host
selected in the Paseo app).

## 5. Project scope — two workspaces yield same project

`createProjectObservation` filters by `projectId` and `archivingAt === null`; `ProjectObservationController`
resolves the project from `paseo.workspaces.ref(openingWorkspaceId).refresh()` once and then
lists all workspaces with that `projectId`. Opening from `workspace-1` or `workspace-2` in the
same project yields the same `view.project` and `view.workspaces` set (ordering is deterministic
by name). Changing the opening workspace only changes the initial discovery; the observed set is
identical for any two active workspaces in `project-1`.

Automated coverage: `observation.test.ts` ("groups agents by active workspace") and
`project-observation.test.ts` ("publishes project agents grouped by active workspace").

Manual verification: see checklist steps 2–3 below.

## 6. Archiving the opening workspace

While another active workspace remains, archiving/removing the opening workspace leaves the
project view in `ready` with the remaining workspaces (not `unavailable`). When the last active
workspace is removed, the state becomes `unavailable: "This project has no active workspaces…"`,
as tested in `project-observation.test.ts:59-95`.

Manual verification: checklist step 7.

## 7. Archived / archiving exclusion

`archivingAt !== null` workspaces are dropped in `createProjectObservation` and never enter
`view.workspaces`, they contribute no counts, produce no attention entries (since
`deriveAttentionQueue` maps only `archivingAt === null` names), and their agents produce no usage
bars (only `finalizedTurns` of agents whose workspace is in the active set are aggregated).

Tests: `observation.test.ts` excludes `archived` and `other-project`; `deriveAttentionQueue`
test excludes `archived` workspace.

## 8. Responsive layout, accessibility, and theme

- `main.client.tsx` styles memo uses `theme.colors.surface0` for screen, `foreground` for titles,
  `foregroundMuted` for subtitles/status, `accent`/`accentForeground` for workspace badges and
  dismiss button, `statusDanger` for failure reasons and output segments. Count: `theme.colors`
  appears 27 times.
- Every layout-dependent value reads `layout.compact` (`padding`, `gap`, `fontSize`, bar heights);
  count: 22 usages. No hardcoded hex literals remain in production code (previous
  `#e5e7eb`/`#374151` were replaced with theme colors; remaining hex uses are not present).
- Widths below 600px are compact, 600–959px are medium (2x2 cards and split analysis), and 960px+
  are wide (four cards and split analysis); `layout.compact` always forces compact.
- Filter, tree, attention, and dismiss controls have at least 44px touch targets. Chart labels
  identify finalized/live status and exact fresh/cached/output composition.

Manual verification: checklist steps 9–10.

## 9. Manual smoke checklist

Perform from a host with a project that has at least two active workspaces (e.g. `Main` and
`Feature`). Create agents via the normal provider flow; parent/child is indicated by the
`paseo.parent-agent-id` label. If no live provider is available, drive the panel with the
mock harness `createPaseoHarness` patterns used in `project-observation.test.ts`.

| # | Action | Expected |
|---|--------|----------|
| 1 | Typecheck & test from `plugins/agent-observatory`: `npm run typecheck && npm test` | Both pass, zero errors, 48 tests green across 4 files |
| 2 | `paseo plugin install <absolute-path>` then `paseo plugin ls` | `agent-observatory  running`; panel **Agent Observatory** appears in Command Center |
| 3 | Open Observatory from **Workspace A** (Main). Note project name and workspace list | Shows all active workspaces in project (e.g. Main, Feature) grouped with agents; lifecycle counts sum correctly; model usage bars visible if any agent reported usage |
| 4 | Without closing, open Observatory from **Workspace B** (Feature) in same project | Same project name and same workspace/agent groupings as step 3 (order may differ by name sort) |
| 5 | Create multiple related agents: one parent and one child with `paseo.parent-agent-id=<parentId>` across the two workspaces | Tree shows indentation (`depth`) and `↳ from <parentTitle>` for child; child paused-state handling (attention) respects parent dependency |
| 6 | Trigger live updates: start a new agent, change an agent status (e.g. running → idle), rename a workspace | Panel updates within seconds without manual refresh (workspace/agent subscriptions); renamed workspace title updates via `receiveWorkspace` |
| 7 | Partial timeline failure: for one agent, make `paseo.agents.ref(agentId).timeline.refetch` reject (e.g. via controller harness error injection or daemon fault) | That agent's **Activity** section shows its `timeline.error` inline; other agents/workspaces/attention queue remain usable (`phase` stays `ready`) |
| 8 | Attention dismissal: wait for or force an attention entry (permission `requiresAttention:true` or inactivity 15 min threshold), then press **Dismiss** | Entry disappears from **Needs attention** immediately (optimistic update), survives `paseo plugin reload agent-observatory` and re-opening from the other workspace (daemon-side store `dismissal-store-node`); removing the agent (`archiving` or `agent: remove`) clears its stored dismissals |
| 9 | Reload: edit `main.client.tsx` (e.g. change a title style), run `npm run typecheck && paseo plugin reload agent-observatory` | Panel reflects new code; `paseo plugin ls` still `running`; no duplicate intervals (check `controller.stop` cleared old timer) and no stale workspace members (archived workspaces stay excluded) |
| 10 | Archive the workspace that opened the panel (keep at least one other active workspace) | Project view remains in `ready`; counts and attention update without that workspace's agents; archiving the last workspace yields `unavailable` message |
| 11 | While archived, verify counts/attention/usage exclude archived workspace's agents | Lifecycle summary counts decrease; attention queue contains no entries from archived workspace; usage bars total excludes its tokens |
| 12 | Layout: resize host to wide desktop, medium tablet, then compact/mobile (or toggle `layout.compact` in a test harness) | Wide has four cards; medium has a 2x2 card grid and split analysis; compact is one column with horizontally scrolling turn charts |
| 13 | Theme: switch host theme light ↔ dark | All text uses `theme.colors.foreground`/`foregroundMuted`; surfaces use `surface0`; accent/status colors adapt — no hardcoded dark-on-light or light-on-dark literals remain |
| 14 | Removal: `paseo plugin uninstall agent-observatory` then `paseo plugin ls` | Plugin no longer listed; panel/command removed |

Record the host version, project name, and `paseo plugin ls` output alongside the checklist for
the release note.

## 10. Remaining verification gaps

- Host with `paseo plugin` subcommand not available on this qualification machine (CLI `0.4.0`).
  Installation/reload verification is documented procedurally above; re-run `paseo plugin install
  <absolute-path> → running` on a host that exposes `paseo plugin ls/install/reload` before
  tagging the release.
- Compact/mobile layout exercised via `layout.compact` code path and visual inspection; no
  automated screenshot harness — checklist steps 12–13 cover it manually.

