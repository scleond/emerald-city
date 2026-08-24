# Agent Observatory

Agent Observatory is a project-scoped view hosted in a native Paseo workspace panel. It shows live
lifecycle counts and groups agents under every active workspace in the project that opened it.
Archiving the opening workspace does not close the project view while another active workspace
remains. Workspace and agent changes arrive through Paseo's host-supplied SDK connection; the
plugin does not open another connection or run a web server.

## Attention hints

The panel includes a deterministic project attention queue. Each agent appears at most once with a
single primary reason, ordered user input (pending permission or question), failure (terminal failed
outcome), then inactivity (a fixed, non-configurable 15 minutes without meaningful progress). The
queue sorts by that priority and then oldest hint first, labels every entry with its workspace, and
selecting an entry focuses the agent for detailed inspection. Heartbeats reset inactivity only when
they report progress or a status change, and observable long-running operations or active child
dependencies pause the timer. Hints are factual triage signals derived purely from host snapshots;
the derivation lives in `observation.ts` with deterministic tests.

## Security — trusted unsandboxed code

Paseo plugins are trusted, unsandboxed local code:

- **Daemon-side code** (`index.ts`, `dismissal-store-node.ts`) runs unsandboxed on the daemon
  machine. It can access files, processes, credentials, and network services on that host.
- **Client code** (`main.client.tsx`, `observation.ts`, `project-observation.ts`) runs inside the
  Paseo app on each connected client, using only client modules supplied by the installed Paseo
  plugin runtime (`@getpaseo/plugin`, `@getpaseo/client`, `react`, `react-native`, `zod`).

Enable the daemon-wide plugin switch manually in **Settings → Plugins** only after you have
reviewed and trusted the source. Automation must obtain explicit user permission before enabling the
daemon-wide plugin switch — do not script `paseo plugin enable` or toggle the setting without a
confirmed human approval. This plugin does not create a second Paseo connection, does not open a
browser tab or webview, and does not start a separate web server (see **Runtime dependencies**
below).

## Develop

All commands run from this directory (`plugins/agent-observatory`):

```sh
npm install        # install dependencies (first time, or after package.json changes)
npm run typecheck  # static typecheck only — must pass before install/reload
npm test           # focused test suite (observation, project-observation, dismissals)
```

`npm run typecheck` uses `tsc --noEmit` with `skipLibCheck: true`. `npm test` runs `vitest run`
over `observation.test.ts`, `project-observation.test.ts`, and `dismissals.test.ts`.

## Install (absolute path)

Typecheck before installing, then install this directory by its **absolute** path. Relative paths
are not resolved by the plugin installer.

```sh
npm run typecheck
paseo plugin install /absolute/path/to/emerald-city/plugins/agent-observatory
```

On Windows use an absolute Windows path, e.g.:

```powershell
paseo plugin install C:\path\to\emerald-city\plugins\agent-observatory
```

If `paseo plugin install <absolute-path>` reports an error, re-run `npm run typecheck` and
`npm test` from `plugins/agent-observatory` and ensure `paseo-plugin.json` is present.

## Status verification

After install the plugin should reach the `running` state and expose **Agent Observatory** on the
intended host:

```sh
paseo plugin ls
# expect: agent-observatory  running  (or "enabled" depending on host version)
```

In the Paseo app:

1. Open any active workspace in the project.
2. Open the Command Center and choose **Open Agent Observatory**.
3. The panel titled **Agent Observatory** appears. It shows the project name, lifecycle summary
   counts, workspace-grouped agents, usage bars, attention queue, and agent detail.

If the panel does not appear, check `paseo plugin ls` again and see **Logs** below. The host shown
in `paseo plugin ls` must match the host selected in the Paseo app.

> Note: the Paseo CLI bundled with some hosts (e.g. `0.4.0`) does not yet expose `paseo plugin`
> subcommands. On those hosts, install and verify through **Settings → Plugins → Install from path**
> in the Paseo app, or update the CLI to a build that includes `paseo plugin ls/install/reload`.
> The verification steps above apply once the host supports the plugin CLI.

## Reload

Source changes require a typechecked reload — no daemon restart is needed:

```sh
npm run typecheck
paseo plugin reload agent-observatory
paseo plugin ls   # should still show running
```

Reload applies the new client and daemon code to already-open panels. The panel recreates its
`ProjectObservationController` per instance; `useEffect` cleanup calls `controller.stop()` which
clears the 15 s refresh interval, unsubscribes workspace/agent listeners, clears per-agent
timeline stream subscriptions, and discards usage/model caches. Daemon-side `contribute()` returns
a cleanup that resets the lazy dismissal-store promise so the next load gets a fresh store handle.
No duplicate subscriptions, timers, stale project membership, or stale RPC work should survive a
reload — verified by `project-observation.test.ts` (stop clears intervals/subscriptions) and by the
manual smoke checklist below.

## Logs

- **Daemon/plugin logs**: check the daemon log stream for `[agent-observatory]` entries. On hosts
  that expose it, use `paseo daemon logs --follow` or the host log file path shown by
  `paseo daemon status`.
- **Client panel errors**: the panel renders explicit `disconnected`, `unavailable`, and
  `partial-data` states. Timeline partial failures surface inline per-agent (`timeline.error`) while
  the rest of the project view remains usable.
- **Typecheck/test failures**: run `npm run typecheck` and `npm test` from
  `plugins/agent-observatory` — both must pass before install/reload.

## Removal

```sh
paseo plugin uninstall agent-observatory
paseo plugin ls   # agent-observatory should no longer appear
```

Or remove via **Settings → Plugins → Agent Observatory → Uninstall**. Uninstall stops the plugin
on the daemon and removes its panel/command. Dismissal persistence is stored daemon-side under the
host's plugin data directory; removing the plugin does not automatically delete that file — delete
it manually if you need a clean slate.

## Project scope and archiving

Opening the panel from any active workspace in a project yields the same project scope: the
controller resolves the opening workspace's `projectId` once and then lists every active
(`archivingAt === null`) workspace in that project. Opening from two workspaces in the same
project shows the same workspace set and agent groupings (verified by
`createProjectObservation` filtering and by manual checklist step 2).

If the workspace that opened the panel is archived while another active workspace remains, the
project view stays open and continues to receive live updates. The view becomes unavailable only
when the project has no active workspaces on the selected host (`project-observation.ts`:
`receiveWorkspace`/`removeWorkspace`). Archived and `archiving` workspaces do not appear and do not
contribute counts, attention, or usage — enforced in `createProjectObservation` and
`deriveAttentionQueue` and covered by `observation.test.ts` and `project-observation.test.ts`.

## Runtime dependencies

The production plugin has no runtime dependency on throwaway HTML prototypes, a browser tab, a
webview, or a separate web server. Verified by `grep` over `plugins/agent-observatory/*.ts{,x}`
excluding tests/docs — no `webview`, `browser`, `prototype`, or `http.*server` imports remain.
Only Paseo client/plugin imports (`@getpaseo/plugin`, `@getpaseo/client`), `react`,
`react-native`, and `zod` are used. See `QUALIFICATION.md` for the grep output.

## Responsive layout, accessibility, and theme

The dashboard keeps four summary cards in a wide row, wraps them to two-by-two at medium widths,
and uses one column in compact mode. The model panel remains full width; analysis shares a row
unless compact mode requires a single column. Per-turn charts scroll horizontally with a minimum
content width so mobile columns remain readable.

All text and surfaces use Paseo theme colors (`theme.colors.surface0`, `foreground`,
`foregroundMuted`, `accent`, `accentForeground`, `statusDanger`) and adapt to `layout.compact`.
Verified by:

- `grep` for `theme.colors` (27 usages) and `layout.compact` (22 usages) in `main.client.tsx`.
- No hardcoded color literals remain in production code (the previous `#e5e7eb`/`#374151`
  dismiss-button literals were replaced with `theme.colors.accent`/`accentForeground`).
- Filter controls expose checkbox state and 44px touch targets. Model charts expose exact token
  composition and cost labels; turn charts identify live/model state and token totals.
- Manual checklist steps 9–13 exercise wide, medium, compact/mobile, light/dark, live usage,
  unknown cost, and partial timeline failure.

## Manual smoke verification

`QUALIFICATION.md` contains the step-by-step manual smoke checklist covering: multiple related
agents across multiple active project workspaces, live updates, partial timeline failure, attention
dismissal (and persistence across reload), archiving the opening workspace, archived-workspace
exclusion, usage bars, attention queue, detail, and wide/compact + light/dark verification.

## Troubleshooting

- `paseo: command not found` — ensure the Paseo CLI is on `PATH` after `paseo onboard`.
- `unknown command 'plugin'` — host CLI predates plugin support; use **Settings → Plugins** in the
  app or update the CLI.
- Panel shows `Host disconnected` — daemon is offline; check `paseo daemon status` and reconnect.
- Panel shows `Data unavailable` — opening workspace missing or permission error; verify the
  workspace still exists on the selected host.
- Dismissal not persisting — check daemon file store permissions and `paseo daemon logs` for
  `dismissal store` errors.

## Repository context

The plugin contributes a **Repository context** attachment source. It lists Git
repositories for explicit selection when no workspace is active, then searches
tracked documents and text files by path or title. Results are immutable,
bounded snapshots with source, generation, and truncation metadata. Before an
item is returned to the composer, its text is previewed and bounded to 32,000
UTF-8 bytes and 400 lines; the returned `text` is the complete point-in-time
attachment payload, not a live file reference. The current working-tree diff is
offered as Git evidence with its `HEAD working tree` basis and an explicit list
of excluded paths. Secret-like paths and generated/dependency directories are
excluded. When no workspace context is available, the first result is an
explicit repository selection item; content is not searched until that item is
selected.

### Context Shelf qualification

The attachment flow is qualified by `repository-snapshots.test.ts`: it covers
tracked-file search, explicit repository selection, UTF-8-safe byte and line
preview bounds, immutable generated text, diff provenance, exclusion reasons,
binary detection, and escaping symlinks. Run `npm test` and `npm run typecheck`
from this directory. The native panel uses the Paseo theme palette throughout
and derives compact spacing/layout from `layout.compact`; verify the attachment
picker and panel at wide and compact widths in both light and dark themes.
