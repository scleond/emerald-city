import { describe, expect, it, vi } from "vitest";
import {
  AttentionDismissalRecordSchema,
  DismissalStoreFileSchema,
  createDismissalStore,
  observatoryDismissalContracts,
  type AttentionDismissalRecord,
  type DismissalFileStorage,
} from "./dismissals";

function record(overrides: Partial<AttentionDismissalRecord> = {}): AttentionDismissalRecord {
  return {
    agentId: "agent-1",
    episodeId: "inactivity:agent-1:123",
    reason: "inactivity",
    dismissedAt: new Date("2026-08-22T12:00:00.000Z").toISOString(),
    ...overrides,
  };
}

function memoryStorage(initial: string | null = null): DismissalFileStorage & { written: string[]; readCount: number } {
  let data: string | null = initial;
  const written: string[] = [];
  let readCount = 0;
  return {
    get written() { return written; },
    get readCount() { return readCount; },
    async read() {
      readCount++;
      return data;
    },
    async write(next: string) {
      data = next;
      written.push(next);
    },
  };
}

describe("AttentionDismissalRecordSchema", () => {
  it("rejects empty agentId", () => {
    expect(() => AttentionDismissalRecordSchema.parse(record({ agentId: "" }))).toThrow();
  });
  it("rejects invalid reason", () => {
    expect(() => AttentionDismissalRecordSchema.parse(record({ reason: "unknown" as never }))).toThrow();
  });
  it("rejects bad dismissedAt", () => {
    expect(() => AttentionDismissalRecordSchema.parse(record({ dismissedAt: "not-a-date" }))).toThrow();
  });
  it("rejects empty projectId on contract input", () => {
    expect(() => observatoryDismissalContracts.get.input.parse({ projectId: "" })).toThrow();
    expect(() => observatoryDismissalContracts.put.input.parse({ projectId: "p", dismissal: record({ agentId: "" }) })).toThrow();
  });
  it("round-trips valid record through contract output", () => {
    const r = record();
    const parsed = observatoryDismissalContracts.get.output.parse({ dismissals: [r] });
    expect(parsed.dismissals).toEqual([r]);
  });
});

describe("DismissalStoreFileSchema", () => {
  it("rejects newer unsupported version without overwriting", () => {
    const bad = JSON.stringify({ version: 2, projects: {} });
    const storage = memoryStorage(bad);
    const store = createDismissalStore({ storage });
    return expect(store.get("project-1")).rejects.toThrow(/schema mismatch/i);
  });
});

describe("createDismissalStore", () => {
  it("put then get returns record", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    const r = record();
    const afterPut = await store.put("project-1", r);
    expect(afterPut).toEqual([r]);
    const got = await store.get("project-1");
    expect(got).toEqual([r]);
  });

  it("second put with same agentId+episodeId replaces", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    const r1 = record({ dismissedAt: new Date("2026-08-22T12:00:00.000Z").toISOString() });
    const r2 = record({ dismissedAt: new Date("2026-08-22T13:00:00.000Z").toISOString() });
    await store.put("project-1", r1);
    const after = await store.put("project-1", r2);
    expect(after).toHaveLength(1);
    expect(after[0]!.dismissedAt).toBe(r2.dismissedAt);
  });

  it("projects are isolated", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    await store.put("project-1", record({ agentId: "a", episodeId: "e1" }));
    await store.put("project-2", record({ agentId: "b", episodeId: "e2" }));
    expect(await store.get("project-1")).toHaveLength(1);
    expect(await store.get("project-2")).toHaveLength(1);
    expect(await store.get("project-1")).toEqual([expect.objectContaining({ agentId: "a" })]);
  });

  it("cross-client second store sees first store write", async () => {
    const storage = memoryStorage();
    const storeA = createDismissalStore({ storage });
    const storeB = createDismissalStore({ storage });
    const r = record({ agentId: "agent-cross", episodeId: "failure:agent-cross:999" });
    await storeA.put("project-1", r);
    expect(await storeB.get("project-1")).toEqual([r]);
  });

  it("storage read failure propagates as usable error and does not call write", async () => {
    const storage: DismissalFileStorage = {
      async read() { throw new Error("EACCES permission denied"); },
      async write() { throw new Error("should not be called"); },
    };
    const store = createDismissalStore({ storage });
    await expect(store.get("project-1")).rejects.toThrow(/EACCES/);
    await expect(store.put("project-1", record())).rejects.toThrow(/EACCES/);
  });

  it("corrupted JSON is not overwritten and put does not call write", async () => {
    let writeCalled = false;
    const storage: DismissalFileStorage = {
      async read() { return "{oops"; },
      async write() { writeCalled = true; },
    };
    const store = createDismissalStore({ storage });
    await expect(store.get("project-1")).rejects.toThrow(/corrupted/i);
    expect(writeCalled).toBe(false);
    await expect(store.put("project-1", record())).rejects.toThrow(/corrupted/i);
    expect(writeCalled).toBe(false);
  });

  it("writes atomically as JSON with version and pruned projects", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    const r = record();
    await store.put("project-1", r);
    expect(storage.written).toHaveLength(1);
    const parsed = JSON.parse(storage.written[0]!);
    expect(DismissalStoreFileSchema.safeParse(parsed).success).toBe(true);
    expect(parsed.version).toBe(1);
    expect(parsed.projects["project-1"]).toEqual([r]);
  });

  it("TTL expiry drops records older than maxAgeMs", async () => {
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const storage = memoryStorage();
    const store = createDismissalStore({ storage, now: () => now, maxAgeMs: 60_000 });
    const old = record({ dismissedAt: new Date(now - 120_000).toISOString(), episodeId: "inactivity:agent-1:old" });
    const fresh = record({ dismissedAt: new Date(now).toISOString(), episodeId: "inactivity:agent-1:fresh" });
    // bypass TTL by using a store with large maxAge to write old
    const writer = createDismissalStore({ storage, maxAgeMs: Number.MAX_SAFE_INTEGER });
    await writer.put("project-1", old);
    await writer.put("project-1", fresh);
    // now reader with short TTL should only see fresh
    expect(await store.get("project-1")).toEqual([fresh]);
  });

  it("removeAgents removes only listed agent records", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    await store.put("project-1", record({ agentId: "keep", episodeId: "inactivity:keep:1" }));
    await store.put("project-1", record({ agentId: "remove", episodeId: "failure:remove:1", reason: "failure" }));
    const after = await store.removeAgents("project-1", ["remove"]);
    expect(after).toEqual([expect.objectContaining({ agentId: "keep" })]);
    expect(await store.get("project-1")).toEqual([expect.objectContaining({ agentId: "keep" })]);
  });

  it("removeAgents with empty list does not mutate", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    const r = record();
    await store.put("project-1", r);
    const before = storage.written.length;
    const after = await store.removeAgents("project-1", []);
    expect(after).toEqual([r]);
    expect(storage.written.length).toBe(before);
  });

  it("concurrent puts are serialized via mutex", async () => {
    const storage = memoryStorage();
    const store = createDismissalStore({ storage });
    const p1 = store.put("project-1", record({ agentId: "a", episodeId: "e:a" }));
    const p2 = store.put("project-1", record({ agentId: "b", episodeId: "e:b" }));
    const [r1, r2] = await Promise.all([p1, p2]);
    // both should succeed, final state has both records
    const final = await store.get("project-1");
    expect(final).toHaveLength(2);
    expect(final.map(r => r.agentId).sort()).toEqual(["a", "b"]);
  });

  it("contract validation rejects max 500 agentIds", () => {
    const ids = Array.from({ length: 501 }, (_, i) => `a${i}`);
    expect(() => observatoryDismissalContracts.removeAgents.input.parse({ projectId: "p", agentIds: ids })).toThrow();
  });
});
