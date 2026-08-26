---
name: obsidian-memory
description: Capture durable conversation context as concise Markdown in an Obsidian vault. Use when the user invokes $obsidian-memory or asks to save decisions, preferences, project knowledge, or follow-up state to Obsidian or their vault.
---

# Obsidian Memory

Turn the useful, durable parts of the current conversation into concise Markdown knowledge. Treat the vault as long-term memory, not as a transcript archive.

## Capture workflow

1. Resolve the vault root in this order:
   - a vault path explicitly supplied by the user for the current request;
   - the `OBSIDIAN_VAULT_PATH` environment variable.
   Read only that named variable rather than listing the environment. Expand path shorthand, resolve the path, and verify that it is an accessible directory. If no valid path is available, explain that an Obsidian vault is a local folder, then ask the user to create a new vault or open an existing folder in Obsidian and supply its root path for the current request or configure `OBSIDIAN_VAULT_PATH`. Do not create folders or persist configuration unless the user asks.
2. Read the vault-root `README.md` when it exists. After choosing a likely destination, read any folder-level `README.md` files that govern that path. More specific instructions override broader ones.
3. Inspect filenames in the likely destination and read only notes relevant to the subject. Avoid scanning private or unrelated notes.
4. Extract information that will remain useful in a later session:
   - decisions and their rationale;
   - user preferences and recurring working conventions;
   - stable project facts, constraints, and terminology;
   - commitments, unresolved questions, and sensible next actions;
   - paths or URLs to authoritative artifacts.
5. Omit conversational filler, duplicated source material, raw chain-of-thought, temporary command output, and details already captured in an authoritative artifact. Link to the artifact instead.
6. Never save credentials, tokens, private keys, or authentication material. Omit sensitive personal data unless the user explicitly requests its storage and it is necessary for the note.
7. Choose a destination using this priority:
   - a vault-relative path explicitly requested by the user;
   - an existing canonical note for the project, person, or topic;
   - the routing rules in the vault's governing README files;
   - an existing `Inbox` directory when classification is uncertain;
   - the vault root when no filing convention or suitable directory exists.
   Use a day log only when the user requests one or the vault's conventions clearly require it.
8. Prefer updating one canonical note over creating near-duplicates. Before editing an existing note, read it completely and make the smallest scoped change that captures the new context. Preserve user-written content, unfamiliar frontmatter, and existing structure; merge new facts into the appropriate sections. Refresh an `updated` property only when the note or vault conventions use one.
9. For a new note, use the applicable vault-owned template when one is identified by the governing instructions or obvious from the note type. Read only the relevant template. Render placeholders such as dates and titles, and adapt provenance fields to the actual writer, for example `source: codex` rather than `source: manual`. If no template applies, follow nearby notes; if there is no local pattern, use a clear title and only the useful sections among Summary, Durable context, Decisions, Open threads, and References.
10. Use local time for dates and Obsidian `[[wikilinks]]` when a related note exists. Do not invent backlinks, tags, people, deadlines, or decisions.
11. Write the note, then report its vault-relative path and a one-sentence summary of what was preserved.

## Capture quality

- Write for a future agent or user who has none of the current chat context.
- Distinguish known facts from inferences and label uncertainty.
- Keep the note compact while retaining rationale that would prevent repeated work.
- If the user supplies a focus after invoking the skill, emphasize that focus while retaining essential dependencies.
