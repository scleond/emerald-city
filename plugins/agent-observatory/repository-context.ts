import { z } from "zod";
import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema, type PluginHandlerContext } from "@getpaseo/plugin/server";
import { diffEvidenceText, gitDiffEvidence, repositoryItem, searchRepository, snapshotText } from "./repository-snapshots";

export const repositoryContextSearch = defineRpc({
  name: "repository-context.search",
  input: z.object({ query: z.string().default(""), workspaceId: z.string().optional(), repositoryPath: z.string().optional() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const repositoryContextSource = defineAttachmentSource({
  id: "repository-context",
  title: "Repository context",
  icon: "FileSearch",
  pickerTitle: "Add repository context",
  searchPlaceholder: "Search files by path or title",
  search: repositoryContextSearch,
});

export async function searchRepositoryContext(input: z.output<typeof repositoryContextSearch.input>, paseo: PluginHandlerContext["paseo"]) {
  const entries = (await paseo.workspaces.list()).entries;
  let repositoryPath = input.repositoryPath;
  if (input.workspaceId) repositoryPath = entries.find((entry) => entry.id === input.workspaceId)?.workspaceDirectory;
  if (!repositoryPath) {
    const repositories = entries.filter((entry) => entry.projectKind === "git");
    return { items: [...new Map(repositories.map((entry) => [entry.workspaceDirectory, repositoryItem(entry.workspaceDirectory)])).values()] };
  }
  if (!entries.some((entry) => entry.projectKind === "git" && entry.workspaceDirectory === repositoryPath)) return { items: [] };
  const snapshots = await searchRepository(repositoryPath, input.query);
  const diff = await gitDiffEvidence(repositoryPath);
  const items = snapshots.map((snapshot) => ({ id: `${repositoryPath}:${snapshot.path}`, identifier: snapshot.path, title: snapshot.title, subtitle: snapshot.truncated ? "Tracked document (truncated)" : "Tracked document", url: `context://repository/${encodeURIComponent(repositoryPath)}/${encodeURIComponent(snapshot.path)}`, text: snapshotText(snapshot), resourceType: "repository-snapshot" as const }));
  if (!input.query.trim() || "diff".includes(input.query.trim().toLowerCase())) items.unshift({ id: `${repositoryPath}:.git-diff`, identifier: ".git-diff", title: diff.title, subtitle: diff.truncated ? "Git diff (truncated)" : "Git diff evidence", url: `context://repository/${encodeURIComponent(repositoryPath)}/.git-diff`, text: diffEvidenceText(diff), resourceType: "repository-snapshot" as const });
  return { items };
}
