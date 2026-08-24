import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { binaryPathsFromNumstat, diffEvidenceText, gitDiffEvidence, previewAttachment, repositoryItem, searchRepository, SNAPSHOT_LIMIT, SNAPSHOT_LINE_LIMIT, snapshotText } from "./repository-snapshots";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

async function repository() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "context-shelf-")); temporary.push(directory); execFileSync("git", ["init", "-q", directory]); return directory; }

describe("repository snapshots", () => {
  it("previews the exact attachment with byte and line bounds", () => {
    const preview = previewAttachment(`${"界".repeat(100)}\nsecond\nthird`, 64, 2);
    expect(preview.truncated).toBe(true);
    expect(preview.lineCount).toBe(1);
    expect(preview.byteLength).toBeLessThanOrEqual(64);
    expect(preview.text).not.toContain("�");
    expect(previewAttachment("a\n".repeat(SNAPSHOT_LINE_LIMIT + 1)).lineCount).toBe(SNAPSHOT_LINE_LIMIT);
  });

  it("bounds the final snapshot envelope without clipping provenance", () => {
    const text = snapshotText({ path: "docs/guide.md", title: "Guide", source: "tracked", content: "x".repeat(SNAPSHOT_LIMIT), truncated: false, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
    expect(text).toContain("Source: tracked file docs/guide.md");
    expect(text).toContain("Generated: 2026-01-01T00:00:00.000Z");
    expect(text).toContain("Truncated: yes");
  });

  it("bounds the final diff envelope while preserving basis and exclusions", () => {
    const text = diffEvidenceText({ path: ".", title: "Working tree diff", source: "git-diff", basis: "HEAD working tree", content: "+界\n".repeat(SNAPSHOT_LINE_LIMIT * 2), truncated: false, generatedAt: "2026-01-01T00:00:00.000Z", excluded: [{ path: "secrets/config.txt", reason: "secret-like filename: secrets/config.txt" }] });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
    expect(text).toContain("Basis: HEAD working tree");
    expect(text).toContain("- secrets/config.txt: secret-like filename: secrets/config.txt");
    expect(text).toContain("Truncated: yes");
  });

  it("never throws for adversarial snapshot metadata or empty content", () => {
    const text = snapshotText({ path: "p".repeat(100_000), title: "界".repeat(100_000), source: "tracked", content: "", truncated: false, generatedAt: "2026-".repeat(100_000) });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
    expect(text).toContain("Source: tracked file");
    expect(text).toContain("Truncated: yes");
  });

  it("summarizes adversarial exclusion metadata without throwing", () => {
    const text = diffEvidenceText({ path: ".", title: "diff", source: "git-diff", basis: "HEAD working tree", content: "", truncated: false, generatedAt: "g".repeat(100_000), excluded: Array.from({ length: 100 }, (_, index) => ({ path: `${index}-secret-${"x".repeat(10_000)}`, reason: "reason-".repeat(10_000) })) });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
    expect(text).toContain("Source: git-diff");
    expect(text).toContain("Basis: HEAD working tree");
    expect(text).toContain("Truncated: yes");
  });

  it("handles exact byte and line limits", () => {
    const text = snapshotText({ path: "p", title: "t", source: "tracked", content: "x".repeat(SNAPSHOT_LIMIT), truncated: false, generatedAt: "now" });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
  });

  it("sanitizes newline-bearing provenance fields without losing required labels", () => {
    const snapshot = snapshotText({ path: "docs/evil\npath.md", title: "title\r\n", source: "tracked", content: "", truncated: false, generatedAt: "2026\n-01" });
    expect(snapshot).toContain("Source: tracked file");
    expect(snapshot).toContain("Generated: 2026\\u000a-01");
    expect(snapshot).toContain("Truncated: yes");
    const diff = diffEvidenceText({ path: ".", title: "diff\n", source: "git-diff", basis: "HEAD working tree", content: "", truncated: false, generatedAt: "now", excluded: [{ path: "bad\nsecret", reason: "reason\r\n" }] });
    expect(diff).toContain("Source: git-diff");
    expect(diff).toContain("Basis: HEAD working tree");
    expect(diff).toContain("Excluded paths:");
  });

  it("summarizes huge exclusion arrays incrementally", () => {
    const exclusions = Array.from({ length: 100_000 }, (_, index) => ({ path: `p${index}\n${"x".repeat(500)}`, reason: "r".repeat(500) }));
    const text = diffEvidenceText({ path: ".", title: "diff", source: "git-diff", basis: "HEAD working tree", content: "", truncated: false, generatedAt: "now", excluded: exclusions });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text).toContain("Source: git-diff");
    expect(text).toContain("Basis: HEAD working tree");
    expect(text).toContain("Exclusions: 100000 total");
    expect(text).toContain("Truncated: yes");
  });

  it("previews oversized tracked files without reading the entire file", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "large.md"), "界".repeat(SNAPSHOT_LIMIT * 4));
    execFileSync("git", ["-C", directory, "add", "."]);
    const snapshot = (await searchRepository(directory, "large", "2026-01-01T00:00:00.000Z"))[0];
    expect(snapshot.truncated).toBe(true);
    expect(Buffer.byteLength(snapshot.content, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(snapshot.content).not.toContain("�");
  });

  it("does not decode a partial four-byte sequence at the bounded read boundary", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "boundary.md"), "a".repeat(SNAPSHOT_LIMIT - 2) + "😀tail");
    execFileSync("git", ["-C", directory, "add", "."]);
    const snapshot = (await searchRepository(directory, "boundary"))[0];
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.content).not.toContain("�");
    expect(snapshot.content.endsWith("😀")).toBe(false);
  });

  it("keeps the final formatter fallback envelope bounded", () => {
    const text = snapshotText({ path: "p".repeat(200_000), title: "t".repeat(200_000), source: "tracked", content: "界".repeat(200_000), truncated: false, generatedAt: "g".repeat(200_000) });
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_LIMIT);
    expect(text.split("\n").length).toBeLessThanOrEqual(SNAPSHOT_LINE_LIMIT);
    expect(text).toContain("Source:");
    expect(text).toContain("Truncated:");
  });

  it("searches tracked documents by path or title and excludes secrets", async () => {
    const directory = await repository();
    await fs.mkdir(path.join(directory, "docs"));
    await fs.writeFile(path.join(directory, "docs/Guide.md"), "hello");
    await fs.writeFile(path.join(directory, "docs/passwords.txt"), "do not expose");
    execFileSync("git", ["-C", directory, "add", "."]);
    expect((await searchRepository(directory, "guide")).map((item) => item.path)).toEqual(["docs/Guide.md"]);
    expect((await searchRepository(directory, "password")).map((item) => item.path)).toEqual([]);
  });

  it("excludes tracked environment variants at every path depth while keeping safe files", async () => {
    const directory = await repository();
    for (const file of [".env.local", ".env.production", "config/.env.development", "config/settings.md"]) {
      await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await fs.writeFile(path.join(directory, file), file);
    }
    execFileSync("git", ["-C", directory, "add", "."]);
    expect((await searchRepository(directory, "")).map((item) => item.path)).toEqual(["config/settings.md"]);
    expect((await searchRepository(directory, "env")).map((item) => item.path)).toEqual([]);
  });

  it("returns only tracked files and excludes generated or dependency paths", async () => {
    const directory = await repository();
    for (const file of ["tracked.md", "untracked.md", "node_modules/pkg.md", "dist/output.md", "build/output.md", "generated/schema.md"]) {
      await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await fs.writeFile(path.join(directory, file), file);
    }
    execFileSync("git", ["-C", directory, "add", "tracked.md", "node_modules/pkg.md", "dist/output.md", "build/output.md", "generated/schema.md"]);
    expect((await searchRepository(directory, "")).map((item) => item.path)).toEqual(["tracked.md"]);
  });

  it("skips a tracked symlink that escapes the repository", async () => {
    const directory = await repository();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "context-shelf-outside-")); temporary.push(outside);
    await fs.writeFile(path.join(outside, "secret.md"), "outside");
    try { await fs.symlink(path.join(outside, "secret.md"), path.join(directory, "escape.md")); } catch { return; }
    execFileSync("git", ["-C", directory, "add", "escape.md"]);
    expect(await searchRepository(directory, "escape")).toEqual([]);
  });

  it("bounds immutable snapshots and includes provenance metadata", async () => {
    const directory = await repository(); const content = "x".repeat(SNAPSHOT_LIMIT + 10);
    await fs.writeFile(path.join(directory, "README.md"), content); execFileSync("git", ["-C", directory, "add", "."]);
    const snapshot = (await searchRepository(directory, "readme", "2026-01-01T00:00:00.000Z"))[0];
    expect(snapshot).toMatchObject({ source: "tracked", truncated: true, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(snapshot.content).toHaveLength(SNAPSHOT_LIMIT); expect(snapshotText(snapshot)).toContain("Truncated: yes");
  });

  it("represents repository selection explicitly", () => expect(repositoryItem("C:\\repo").resourceType).toBe("repository"));

  it("returns bounded working-tree diff evidence with provenance", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "README.md"), "before\n"); execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    await fs.writeFile(path.join(directory, "README.md"), "after\n");
    const evidence = await gitDiffEvidence(directory, "2026-01-01T00:00:00.000Z");
    expect(evidence).toMatchObject({ source: "git-diff", basis: "HEAD working tree", truncated: false, generatedAt: "2026-01-01T00:00:00.000Z", excluded: [] });
    expect(evidence.content).toContain("-before"); expect(evidence.content).toContain("+after"); expect(diffEvidenceText(evidence)).toContain("Source: git-diff");
  });

  it("excludes changed secrets, generated files, binaries, and escaping symlinks with reasons", async () => {
    const directory = await repository(); const outside = await fs.mkdtemp(path.join(os.tmpdir(), "context-shelf-outside-")); temporary.push(outside);
    await fs.writeFile(path.join(directory, "safe.md"), "safe\n"); await fs.writeFile(path.join(directory, "passwords.txt"), "secret\n"); await fs.mkdir(path.join(directory, "generated")); await fs.writeFile(path.join(directory, "generated/out.md"), "generated\n"); await fs.writeFile(path.join(outside, "outside.md"), "outside\n");
    try { await fs.symlink(path.join(outside, "outside.md"), path.join(directory, "escape.md")); } catch { return; }
    execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    await fs.writeFile(path.join(directory, "safe.md"), "changed\n"); await fs.writeFile(path.join(directory, "passwords.txt"), "new secret\n"); await fs.writeFile(path.join(directory, "generated/out.md"), "new generated\n");
    const evidence = await gitDiffEvidence(directory);
    expect(evidence.content).toContain("+changed"); expect(evidence.content).not.toContain("secret"); expect(evidence.content).not.toContain("generated"); expect(evidence.excluded.map((item) => item.path)).toEqual(expect.arrayContaining(["passwords.txt", "generated/out.md", "escape.md"]));
    expect(diffEvidenceText(evidence)).toContain("Excluded paths:");
  });

  it("bounds multibyte diff output and reports truncation", async () => {
    const directory = await repository(); const initial = "界".repeat(20_000); await fs.writeFile(path.join(directory, "README.md"), initial); execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]); await fs.writeFile(path.join(directory, "README.md"), "界".repeat(20_000) + "changed");
    const evidence = await gitDiffEvidence(directory); expect(evidence.truncated).toBe(true); expect(Buffer.byteLength(evidence.content)).toBeLessThanOrEqual(32_000); expect(evidence.content).not.toContain("�");
  });

  it("excludes changed and deleted binary content even with text-like extensions", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "changed.md"), Buffer.from([0, 1, 2, 3])); await fs.writeFile(path.join(directory, "deleted.json"), Buffer.from([0, 4, 5, 6]));
    execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    await fs.writeFile(path.join(directory, "changed.md"), Buffer.from([0, 7, 8, 9])); await fs.rm(path.join(directory, "deleted.json"));
    const evidence = await gitDiffEvidence(directory);
    expect(evidence.content).not.toContain("changed.md"); expect(evidence.content).not.toContain("deleted.json");
    expect(evidence.excluded).toEqual(expect.arrayContaining([{ path: "changed.md", reason: "binary file content" }, { path: "deleted.json", reason: "binary file content" }]));
  });

  it("detects binary content in a large changed file from a bounded prefix", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "large.md"), Buffer.concat([Buffer.from([0]), Buffer.alloc(2_000_000, 65)]));
    execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    await fs.writeFile(path.join(directory, "large.md"), Buffer.concat([Buffer.from([0]), Buffer.alloc(2_000_000, 66)]));
    const evidence = await gitDiffEvidence(directory);
    expect(evidence.content).not.toContain("large.md");
    expect(evidence.excluded).toContainEqual({ path: "large.md", reason: "binary file content" });
  });

  it("does not turn non-buffer subprocess errors into evidence", async () => {
    const directory = await repository(); await fs.writeFile(path.join(directory, "README.md"), "content\n"); execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    await expect(gitDiffEvidence(path.join(directory, "missing-repository"))).rejects.toBeTruthy();
  });

  it("excludes both endpoints of a binary rename", async () => {
    const directory = await repository(); const oldPath = path.join(directory, "image.md"); const newPath = path.join(directory, "renamed.md");
    await fs.writeFile(oldPath, Buffer.from([0, 1, 2, 3, 4])); execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    execFileSync("git", ["-C", directory, "mv", "image.md", "renamed.md"]);
    const evidence = await gitDiffEvidence(directory);
    expect(evidence.content).not.toContain("image.md"); expect(evidence.content).not.toContain("renamed.md");
    expect(evidence.excluded).toEqual(expect.arrayContaining([{ path: "image.md", reason: "binary file content" }, { path: "renamed.md", reason: "binary file content" }]));
    expect([...binaryPathsFromNumstat("-\t-\trenamed.md\0image.md\0")]).toEqual(["renamed.md", "image.md"]);
  });

  it("propagates exclusions across a secret-to-safe rename", async () => {
    const directory = await repository();
    await fs.writeFile(path.join(directory, "passwords.json"), "TOP-SECRET-CONTENT\n"); execFileSync("git", ["-C", directory, "add", "."]); execFileSync("git", ["-C", directory, "commit", "-qm", "initial"]);
    execFileSync("git", ["-C", directory, "mv", "passwords.json", "config.json"]); await fs.writeFile(path.join(directory, "config.json"), "TOP-SECRET-CONTENT\nnew\n");
    const evidence = await gitDiffEvidence(directory);
    expect(evidence.content).not.toContain("TOP-SECRET-CONTENT");
    expect(evidence.excluded).toEqual(expect.arrayContaining([{ path: "passwords.json", reason: "secret-like filename: passwords.json" }, { path: "config.json", reason: "secret-like filename: passwords.json" }]));
  });
});
