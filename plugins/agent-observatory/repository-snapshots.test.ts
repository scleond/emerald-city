import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diffEvidenceText, gitDiffEvidence, repositoryItem, searchRepository, SNAPSHOT_LIMIT, snapshotText } from "./repository-snapshots";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

async function repository() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "context-shelf-")); temporary.push(directory); execFileSync("git", ["init", "-q", directory]); return directory; }

describe("repository snapshots", () => {
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
    expect(evidence).toMatchObject({ source: "git-diff", truncated: false, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(evidence.content).toContain("-before"); expect(evidence.content).toContain("+after"); expect(diffEvidenceText(evidence)).toContain("Source: git-diff");
  });
});
