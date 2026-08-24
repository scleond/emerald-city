import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const SNAPSHOT_LIMIT = 32_000;
export const SNAPSHOT_LINE_LIMIT = 400;
export const DIFF_LIMIT = 32_000;
const EXCLUSION_LIMIT = 100;
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc", ".json", ".yaml", ".yml", ".toml", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html", ".xml", ".csv"]);
const EXCLUDED_PARTS = new Set([".git", "node_modules", ".env", ".venv", "dist", "build", "generated", "coverage"]);
const SECRET_NAME = /(^|[._-])(secret|secrets|credential|credentials|token|passwords?|passwd|apikey|api-key)([._-]|$)/i;
const ENVIRONMENT_FILE = /^\.env(?:\..+)?$/i;

export interface RepositorySnapshot { path: string; title: string; source: "tracked"; content: string; truncated: boolean; generatedAt: string; }
export interface RepositoryDiffExclusion { path: string; reason: string; }
export interface RepositoryDiffEvidence { path: string; title: string; source: "git-diff"; basis: "HEAD working tree"; content: string; truncated: boolean; generatedAt: string; excluded: RepositoryDiffExclusion[]; }
export interface RepositorySearchItem { id: string; identifier: string; title: string; subtitle?: string; url: string; text: string; resourceType: "repository-snapshot" | "repository"; }
export interface AttachmentPreview { text: string; byteLength: number; lineCount: number; truncated: boolean; }

function boundedText(value: string, byteLimit: number, lineLimit: number): AttachmentPreview {
  const lines = value.split("\n");
  let text = lines.slice(0, lineLimit).join("\n");
  let truncated = lines.length > lineLimit;
  while (Buffer.byteLength(text, "utf8") > byteLimit) {
    truncated = true;
    const bytes = Buffer.from(text, "utf8").subarray(0, byteLimit);
    text = bytes.toString("utf8").replace(/\uFFFD$/, "");
  }
  return { text, byteLength: Buffer.byteLength(text, "utf8"), lineCount: text ? text.split("\n").length : 0, truncated };
}

function renderAttachment(metadata: string[], content: string, inputTruncated: boolean): string {
  const metadataWithoutFlag = [...metadata, "Truncated: no"].join("\n");
  const metadataLines = metadataWithoutFlag.split("\n").length;
  const metadataBytes = Buffer.byteLength(metadataWithoutFlag, "utf8") + 2;
  if (metadataBytes > SNAPSHOT_LIMIT || metadataLines >= SNAPSHOT_LINE_LIMIT) {
    throw new Error("attachment metadata exceeds the composer snapshot limits");
  }
  const contentPreview = boundedText(content, SNAPSHOT_LIMIT - metadataBytes - 2, SNAPSHOT_LINE_LIMIT - metadataLines - 2);
  const truncated = inputTruncated || contentPreview.truncated;
  const renderedMetadata = [...metadata, `Truncated: ${truncated ? "yes" : "no"}`];
  const rendered = `${renderedMetadata.join("\n")}\n\n${contentPreview.text}`;
  // The truncation field is metadata and is deliberately rendered after the content budget is known.
  if (Buffer.byteLength(rendered, "utf8") > SNAPSHOT_LIMIT || rendered.split("\n").length > SNAPSHOT_LINE_LIMIT) {
    throw new Error("attachment metadata exceeds the composer snapshot limits");
  }
  return rendered;
}

/** Creates the exact, bounded text that will be copied into a composer attachment. */
export function previewAttachment(text: string, byteLimit = SNAPSHOT_LIMIT, lineLimit = SNAPSHOT_LINE_LIMIT): AttachmentPreview {
  return boundedText(text, byteLimit, lineLimit);
}

export function exclusionReason(filePath: string): string | null {
  const parts = filePath.split(/[\\/]/);
  const excludedPart = parts.find((part) => EXCLUDED_PARTS.has(part));
  if (excludedPart) return `excluded directory or dependency path: ${excludedPart}`;
  const environmentPart = parts.find((part) => ENVIRONMENT_FILE.test(part));
  if (environmentPart) return `environment file: ${environmentPart}`;
  const secretPart = parts.find((part) => SECRET_NAME.test(part));
  if (secretPart) return `secret-like filename: ${secretPart}`;
  return null;
}
function excluded(filePath: string) { return exclusionReason(filePath) !== null; }
function recognized(filePath: string) { return DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !excluded(filePath); }
function isMaxBufferError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || candidate.message?.includes("maxBuffer") === true;
}
export function binaryPathsFromNumstat(value: string) {
  const records = value.split("\0"); const paths = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const fields = records[index].split("\t");
    if (fields.length < 3 || fields[0] !== "-" || fields[1] !== "-") continue;
    paths.add(fields.slice(2).join("\t"));
    const renameSource = records[index + 1];
    if (renameSource && !renameSource.includes("\t")) { paths.add(renameSource); index += 1; }
  }
  return paths;
}

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
    const preview = previewAttachment(raw);
    results.push({ path: relativePath, title, source: "tracked", content: preview.text, truncated: preview.truncated, generatedAt });
  }
  return results;
}

export function snapshotText(snapshot: RepositorySnapshot) {
  return renderAttachment([`# ${snapshot.title}`, `Source: ${snapshot.source} file ${snapshot.path}`, `Generated: ${snapshot.generatedAt}`], snapshot.content, snapshot.truncated);
}

export function diffEvidenceText(evidence: RepositoryDiffEvidence) {
  const exclusions = evidence.excluded.length === 0 ? "None" : evidence.excluded.map(({ path: filePath, reason }) => `- ${filePath}: ${reason}`).join("\n");
  return renderAttachment([`# ${evidence.title}`, `Source: ${evidence.source}`, `Basis: ${evidence.basis}`, `Generated: ${evidence.generatedAt}`, "Excluded paths:", exclusions], evidence.content, evidence.truncated);
}

export async function gitDiffEvidence(repositoryPath: string, generatedAt = new Date().toISOString()): Promise<RepositoryDiffEvidence> {
  const root = await fs.realpath(repositoryPath);
  const [{ stdout: names }, { stdout: numstat }, { stdout: nameStatus }, { stdout: endpointStatus }] = await Promise.all([
    execFileAsync("git", ["-C", repositoryPath, "diff", "--name-only", "-z", "HEAD", "--", "."], { maxBuffer: 8 * 1024 * 1024 }),
    // Disable rename collapsing for classification: this gives us both binary endpoints.
    execFileAsync("git", ["-C", repositoryPath, "diff", "--no-renames", "--numstat", "-z", "--format=", "HEAD", "--", "."], { maxBuffer: 8 * 1024 * 1024 }),
    execFileAsync("git", ["-C", repositoryPath, "diff", "--name-status", "-z", "--find-renames", "HEAD", "--", "."], { maxBuffer: 8 * 1024 * 1024 }),
    execFileAsync("git", ["-C", repositoryPath, "diff", "--name-status", "-z", "--no-renames", "HEAD", "--", "."], { maxBuffer: 8 * 1024 * 1024 }),
  ]);
  const binaryPaths = binaryPathsFromNumstat(numstat.toString());
  const endpointTokens = endpointStatus.toString().split("\0");
  const endpointPaths: string[] = [];
  for (let index = 0; index < endpointTokens.length; index += 1) {
    const status = endpointTokens[index];
    if (!status) continue;
    if (/^[RC]\d+$/.test(status)) { if (endpointTokens[index + 1]) endpointPaths.push(endpointTokens[index + 1]); if (endpointTokens[index + 2]) endpointPaths.push(endpointTokens[index + 2]); index += 2; }
    else if (endpointTokens[index + 1]) { endpointPaths.push(endpointTokens[index + 1]); index += 1; }
  }
  for (const filePath of endpointPaths) {
    if (binaryPaths.has(filePath)) continue;
    try {
      const content = await fs.readFile(path.resolve(root, filePath)); if (content.includes(0)) binaryPaths.add(filePath);
    } catch {
      try { const result = await execFileAsync("git", ["-C", repositoryPath, "show", `HEAD:${filePath}`], { encoding: "buffer", maxBuffer: 256 * 1024 }); if (Buffer.from(result.stdout).includes(0)) binaryPaths.add(filePath); } catch { /* path may be newly added */ }
    }
  }
  const renameExclusions = new Map<string, string>();
  const statusRecords = nameStatus.toString().split("\0");
  for (let index = 0; index < statusRecords.length; index += 1) {
    const status = statusRecords[index];
    if (!/^R\d+$/.test(status)) continue;
    const oldPath = statusRecords[index + 1]; const newPath = statusRecords[index + 2];
    if (!oldPath || !newPath) continue;
    const reason = exclusionReason(oldPath) ?? exclusionReason(newPath) ?? (!recognized(oldPath) || !recognized(newPath) ? "unsupported or binary file type" : null);
    if (reason) { renameExclusions.set(oldPath, reason); renameExclusions.set(newPath, reason); }
    if (binaryPaths.has(oldPath) || binaryPaths.has(newPath)) { binaryPaths.add(oldPath); binaryPaths.add(newPath); }
    index += 2;
  }
  const excluded: RepositoryDiffExclusion[] = [];
  const allowed: string[] = [];
  for (const filePath of [...new Set([...names.toString().split("\0").filter(Boolean), ...endpointPaths])]) {
    const policyReason = renameExclusions.get(filePath) ?? exclusionReason(filePath) ?? (binaryPaths.has(filePath) ? "binary file content" : (!recognized(filePath) ? "unsupported or binary file type" : null));
    const candidate = path.resolve(root, filePath);
    let unsafe = false;
    try {
      const target = await fs.realpath(candidate);
      const relative = path.relative(root, target);
      unsafe = relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    } catch {
      // A deleted file has no current target and is safe to diff by its tracked path.
    }
    const reason = policyReason ?? (unsafe ? "path resolves outside the repository" : null);
    if (reason) { if (excluded.length < EXCLUSION_LIMIT) excluded.push({ path: filePath, reason }); } else allowed.push(filePath);
  }
  for (const [filePath, reason] of renameExclusions) if (!excluded.some((item) => item.path === filePath) && excluded.length < EXCLUSION_LIMIT) excluded.push({ path: filePath, reason });
  let output = Buffer.alloc(0);
  let truncated = false;
  if (allowed.length > 0) {
    try {
      const result = await execFileAsync("git", ["-C", repositoryPath, "diff", "HEAD", "--", ...allowed], { maxBuffer: Math.max(DIFF_LIMIT * 2, 256 * 1024), encoding: "buffer" });
      output = Buffer.from(result.stdout);
    } catch (error) {
      const partial = (error as { stdout?: Buffer | string }).stdout;
      if (isMaxBufferError(error) && partial !== undefined) { output = Buffer.from(partial); truncated = true; } else throw error;
    }
  }
  if (output.byteLength > DIFF_LIMIT) { output = output.subarray(0, DIFF_LIMIT); truncated = true; }
  const content = output.toString("utf8").replace(/\uFFFD(?=[^\n]*$)/, "");
  return { path: ".", title: "Working tree diff", source: "git-diff", basis: "HEAD working tree", content: content || "No included tracked changes in the working tree.", truncated, generatedAt, excluded };
}

export function repositoryItem(repositoryPath: string): RepositorySearchItem {
  const name = path.basename(repositoryPath) || repositoryPath;
  return { id: repositoryPath, identifier: repositoryPath, title: name, subtitle: "Select a repository", url: `context://repository/${encodeURIComponent(repositoryPath)}`, text: repositoryPath, resourceType: "repository" };
}
