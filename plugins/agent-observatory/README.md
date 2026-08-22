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

## Develop

```sh
npm install
npm test
npm run typecheck
```

## Install

Plugins are trusted, unsandboxed code. Backend plugin code can access the daemon machine,
including files, processes, credentials, and network services. Client plugin code runs inside the
Paseo app. Enable the daemon-wide plugin switch manually in **Settings → Plugins** only after you
have reviewed and trusted the source.

Typecheck before installing, then install this directory by its absolute path:

```sh
npm run typecheck
paseo plugin install /absolute/path/to/emerald-city/plugins/agent-observatory
paseo plugin ls
```

In any active workspace, open the Command Center and choose **Open Agent Observatory**. Paseo opens
the panel for that workspace's project. Source changes require
`paseo plugin reload agent-observatory` after a successful typecheck.
