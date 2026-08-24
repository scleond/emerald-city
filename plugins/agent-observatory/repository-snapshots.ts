import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const SNAPSHOT_LIMIT = 32_000;
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".toml", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".xml", ".csv"]);
const EXCLUDED_PARTS = new Set([".git", "node_modules", ".env", ".venv", "dist", "build", "generated", "coverage"]);
const SECRET_NAME = /(^|[._-])(secret|secrets|credential|credentials|token|passwords?|passwd|apikey|api-key)([._-]|$)/i;
const ENVIRONMENT_FILE = /^\.env(?:\..+)?$/i;

export interface RepositorySnapshot { path: string; title: string; source: "tracked"; content: string; truncated: boolean; generatedAt: string; }
export interface RepositorySearchItem { id: string; identifier: string; title: string; subtitle?: string; url: string; text: string; resourceType: "repository-snapshot" | "repository"; }

function excluded(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts.some((part) => EXCLUDED_PARTS.has(part) || ENVIRONMENT_FILE.test(part) || SECRET_NAME.test(part));
}
function recognized(filePath: string) { return DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !excluded(filePath); }

export async function trackedDocumentPaths(repositoryPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["-C", repositoryPath, "ls-files", "-z"], { maxBuffer: 2_000_000 });
  return stdout.split("\0").filter(Boolean).filter(recognized).sort();
}

async function safeRead(repositoryPath: string, relativePath: string): Promise<string | null> {
  const root = await fs.realpath(repositoryPath);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  try {
    const target = await fs.realpath(candidate);
    const targetRelative = path.relative(root, target);
    if (targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)) return null;
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

export async function searchRepository(repositoryPath: string, query: string, generatedAt = new Date().toISOString()): Promise<RepositorySnapshot[]> {
  const normalized = query.trim().toLowerCase();
  const results: RepositorySnapshot[] = [];
  for (const relativePath of await trackedDocumentPaths(repositoryPath)) {
    const title = path.basename(relativePath, path.extname(relativePath));
    if (normalized && !relativePath.toLowerCase().includes(normalized) && !title.toLowerCase().includes(normalized)) continue;
    const raw = await safeRead(repositoryPath, relativePath);
    if (raw === null) continue;
    const truncated = raw.length > SNAPSHOT_LIMIT;
    results.push({ path: relativePath, title, source: "tracked", content: raw.slice(0, SNAPSHOT_LIMIT), truncated, generatedAt });
  }
  return results;
}

export function snapshotText(snapshot: RepositorySnapshot) {
  return [`# ${snapshot.title}`, `Source: ${snapshot.source} file ${snapshot.path}`, `Generated: ${snapshot.generatedAt}`, `Truncated: ${snapshot.truncated ? "yes" : "no"}`, "", snapshot.content].join("\n");
}

export function repositoryItem(repositoryPath: string): RepositorySearchItem {
  const name = path.basename(repositoryPath) || repositoryPath;
  return { id: repositoryPath, identifier: repositoryPath, title: name, subtitle: "Select a repository", url: `context://repository/${encodeURIComponent(repositoryPath)}`, text: repositoryPath, resourceType: "repository" };
}
