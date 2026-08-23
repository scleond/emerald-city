import * as os from "node:os";
import * as path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createUsageTurnStore, type UsageTurnStore } from "./usage-turns";

export function createFileUsageTurnStore(options?: { filePath?: string; now?: () => number; maxAgeMs?: number }): UsageTurnStore {
  const filePath = options?.filePath ?? process.env.PASEO_AGENT_OBSERVATORY_USAGE_STORE_PATH ?? path.join(os.tmpdir(), "paseo-plugin-agent-observatory", "usage-turns.json");
  return createUsageTurnStore({
    now: options?.now, maxAgeMs: options?.maxAgeMs,
    storage: {
      async read() { try { return await readFile(filePath, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } },
      async write(data) { await mkdir(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`; await writeFile(temporary, data, "utf8"); await rename(temporary, filePath); },
    },
  });
}
