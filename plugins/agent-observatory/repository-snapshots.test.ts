import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repositoryItem, searchRepository, SNAPSHOT_LIMIT, snapshotText } from "./repository-snapshots";

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

  it("bounds immutable snapshots and includes provenance metadata", async () => {
    const directory = await repository(); const content = "x".repeat(SNAPSHOT_LIMIT + 10);
    await fs.writeFile(path.join(directory, "README.md"), content); execFileSync("git", ["-C", directory, "add", "."]);
    const snapshot = (await searchRepository(directory, "readme", "2026-01-01T00:00:00.000Z"))[0];
    expect(snapshot).toMatchObject({ source: "tracked", truncated: true, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(snapshot.content).toHaveLength(SNAPSHOT_LIMIT); expect(snapshotText(snapshot)).toContain("Truncated: yes");
  });

  it("represents repository selection explicitly", () => expect(repositoryItem("C:\\repo").resourceType).toBe("repository"));
});
