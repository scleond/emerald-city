# Agent Skills

Agent skills for code review, issue-driven development, and technical writing.

## Skills

| Skill | Purpose |
|-------|---------|
| `boss-issue-loop` | Runs a reviewed GitHub issue loop: selects scoped work, delegates implementation, verifies independent reviews, integrates and pushes, closes issues, and cleans disposable resources. |
| `ste-style` | Rewrites or authors text in simplified technical English — one clear meaning per sentence, active voice, consistent terminology. |

## Installation

Copy the desired skill folder into one of the standard agent-skill locations:

- **opencode** — `~/.agents/skills/<skill-name>/`
- **Claude Code** — `~/.claude/agents/skills/<skill-name>/`
- **Generic** — the location your agent tooling reads for custom skills.

Each skill is a self-contained directory with a `SKILL.md` entry point. After copying, the skill appears in your agent's available-skills list on the next session.

## External tooling

The skills assume:

- **`gh` CLI** — authenticated (`gh auth status`) and able to read/write repository issues, labels, and comments.
- **An agent orchestrator** — one of the packaged adapters (Paseo or Herdr) or a custom adapter satisfying the orchestration interface. The `boss-issue-loop` skill resolves its adapter at runtime from `ORCHESTRATION.md`.

## Configuration

The `boss-issue-loop` skill has a layered configuration model (packaged, user/machine, repository). For setup instructions see the [boss-issue-loop README](skills/boss-issue-loop/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue workflow, labels, and spec-driven ticket process.

## License

[MIT](LICENSE)
