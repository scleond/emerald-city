# Agent Observatory

Agent Observatory is a native Paseo workspace panel. It shows live lifecycle counts and a basic
agent list for the workspace that opened it. Workspace and agent changes arrive through Paseo's
host-supplied SDK connection; the plugin does not open another connection or run a web server.

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

In a workspace, open the Command Center and choose **Open Agent Observatory**. Paseo opens the
workspace-scoped panel. Source changes require `paseo plugin reload agent-observatory` after a
successful typecheck.
