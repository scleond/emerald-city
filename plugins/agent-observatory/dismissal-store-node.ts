import * as os from "node:os";
import * as path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createDismissalStore, type DismissalStore, type DismissalFileStorage } from "./dismissals";

export function createFileDismissalStore(options?: {
  filePath?: string;
  now?: () => number;
  maxAgeMs?: number;
}): DismissalStore {
  const filePath =
    options?.filePath ??
    process.env.PASEO_AGENT_OBSERVATORY_STORE_PATH ??
    path.join(os.tmpdir(), "paseo-plugin-agent-observatory", "dismissals.json");

  const storage: DismissalFileStorage = {
    async read(): Promise<string | null> {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        throw error;
      }
    },
    async write(data: string): Promise<void> {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await writeFile(tmpPath, data, "utf8");
      await rename(tmpPath, filePath);
    },
  };

  return createDismissalStore({
    storage,
    now: options?.now,
    maxAgeMs: options?.maxAgeMs,
  });
}
