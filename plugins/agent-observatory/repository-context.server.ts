import type { output as ZodOutput } from "zod";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { repositoryContextSearch } from "./repository-context.shared";
import { diffEvidenceText, gitDiffEvidence, repositoryItem, searchRepository, snapshotText } from "./repository-snapshots.server";

export async function searchRepositoryContext(input: ZodOutput<typeof repositoryContextSearch.input>, paseo: PluginHandlerContext["paseo"]) {
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
