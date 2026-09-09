# Paseo configuration notes

Reusable prompts and setup notes for Paseo-managed agents.

## Windows GitHub authentication

[The appended prompt](prompts/windows-github-auth.md) tells agents to request approved execution outside the Codex sandbox for authorized GitHub operations. It does not grant approval or disable sandboxing.

On the tested Windows host, GitHub CLI credentials were valid in the normal user's Windows keyring. Commands inside Codex's elevated sandbox ran as `codexsandboxoffline`: `gh auth status` reported an invalid token and `gh api user --jq .login` returned HTTP 401. The same checks succeeded through approved execution outside the sandbox. This is a sandbox/keyring access issue; the sandbox error alone is not evidence that credentials need replacing.

## Install on a daemon

1. Run `paseo daemon status --json` on the affected host and locate its reported home directory. The default native Windows configuration is `%USERPROFILE%\.paseo\config.json`.
2. Copy the text from [windows-github-auth.md](prompts/windows-github-auth.md) into the JSON string at `daemon.appendSystemPrompt`. Preserve any existing instructions and other configuration fields. A JSON editor must escape literal newlines if you combine paragraphs.
3. Apply the file change:

   ```powershell
   paseo daemon reload --json
   ```

4. Confirm that `appliedPaths` includes `daemon.appendSystemPrompt` and `restartRequiredPaths` is empty. Start a fresh agent to verify the result.

The setting is stored on the daemon and persists across restarts. It applies to newly created agents across that daemon's projects and providers. Configure other hosts separately. Existing sessions may retain their earlier instructions.

Editing the file alone was insufficient in the test: the first new agent did not receive the prompt until the explicit reload completed.

## Verify with a fresh agent

Launch a Codex agent in **Auto-review** mode with this task:

> Run a read-only check that GitHub CLI authentication works: `gh auth status`, followed by `gh api user --jq .login`. Follow the machine instructions already supplied to you. Do not change files, credentials, or GitHub state. Report whether your initial instructions include guidance about Windows keyring/GitHub execution, which execution permission path you used, command exit codes, and the authenticated login. Never print tokens.

Expected results:

- The agent confirms receiving the appended guidance.
- It requests `require_escalated` execution through the normal approval mechanism.
- Both commands exit with code 0 and the API returns the expected GitHub login.

If approval is denied, report that outcome rather than treating the instruction as authorization to bypass the denial.

## Tested configuration and findings

Verified on September 9, 2026 with native Windows, a Desktop-managed Paseo `0.8.0-beta.1` daemon, Codex CLI `0.153.4`, and a fresh `gpt-5.6-sol` agent in Auto-review mode. After reloading the prompt, the agent used approved execution outside the sandbox and both authentication checks passed. Credentials and GitHub state were unchanged.

Comparing Paseo `0.7.2` and `0.8.0-beta.1` found no change to the Codex Auto-review sandbox preset: both use `workspace-write`, `on-request`, and automatic approval review. The provider-options file was identical. Agent-creation preference handling changed, but the investigation did not establish what historical change first caused the local authentication failure.

References:

- [Paseo version comparison](https://github.com/getpaseo/paseo/compare/v0.7.2...v0.8.0-beta.1)
- [Agent-creation preference changes, PR #4401](https://github.com/getpaseo/paseo/pull/4401)
- [Codex Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [Paseo 0.8 lifecycle hooks](https://github.com/getpaseo/paseo/blob/v0.8.0-beta.1/public-docs/plugins/v0.8/reference.md#lifecycle-hooks) for provider-specific prompt customization through `agent.create`
