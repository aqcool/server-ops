import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createBindingsStore(filePath) {
  let pendingWrite = Promise.resolve();

  async function readIds() {
    try {
      const text = await readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.serverIds)) {
        return parsed.serverIds.filter((item) => typeof item === "string" && item.length > 0);
      }
      return [];
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) {
        return [];
      }
      throw error;
    }
  }

  function writeIds(serverIds) {
    const unique = [...new Set(serverIds)];
    const nextWrite = pendingWrite.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, JSON.stringify({ serverIds: unique }, null, 2), { mode: 0o600 });
        await rename(tempPath, filePath);
      } catch (error) {
        await unlink(tempPath).catch(() => {});
        throw error;
      }
      return unique;
    });
    pendingWrite = nextWrite.catch(() => {});
    return nextWrite;
  }

  return { readIds, writeIds };
}
