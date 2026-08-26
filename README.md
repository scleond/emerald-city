# Agent Skills

Agent skills for durable knowledge, issue-driven development, and technical writing.

## Skills

| Skill | Purpose |
|-------|---------|
| `boss-issue-loop` | Runs a reviewed GitHub issue loop: selects scoped work, delegates implementation, verifies independent reviews, integrates and pushes, closes issues, and cleans disposable resources. |
| `obsidian-memory` | Saves durable conversation context as concise Markdown in a configured Obsidian vault. |
| `ste-style` | Rewrites or authors text in simplified technical English — one clear meaning per sentence, active voice, consistent terminology. |

## Installation

Copy the desired skill folder into one of the standard agent-skill locations:

- **Codex** — `$CODEX_HOME/skills/<skill-name>/`, or `~/.codex/skills/<skill-name>/` when `CODEX_HOME` is unset.
- **opencode** — `~/.agents/skills/<skill-name>/`
- **Claude Code** — `~/.claude/agents/skills/<skill-name>/`
- **Generic** — the location your agent tooling reads for custom skills.

Each skill is a self-contained directory with a `SKILL.md` entry point. After copying, the skill appears in your agent's available-skills list on the next session.

## External tooling

Requirements are skill-specific:

- **`boss-issue-loop`** — an authenticated `gh` CLI with repository permissions, plus Paseo, Herdr, or a custom agent orchestrator satisfying the packaged interface.
- **`obsidian-memory`** — read/write filesystem access to the selected vault. Obsidian does not need to be running, and no Obsidian plugin is required.
- **`ste-style`** — no external tooling.

## Configuration

### Obsidian Memory

Pass the vault root explicitly when invoking the skill, or set `OBSIDIAN_VAULT_PATH` in the agent's environment. An explicit path takes precedence, which makes multiple-vault workflows possible without changing the default. If no vault exists yet, create a new vault or open an existing folder as a vault in Obsidian, then supply that folder's path. The skill does not create folders or persist configuration unless requested.

### Boss Issue Loop

The `boss-issue-loop` skill has a layered configuration model (packaged, user/machine, repository). For setup instructions see the [boss-issue-loop README](skills/boss-issue-loop/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue workflow, labels, and spec-driven ticket process.

## License

[MIT](LICENSE)
