import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MiddlewareTrace, TraceDatabase, TraceFilter } from "./types.js";

const emptyDatabase = (): TraceDatabase => ({ version: 1, traces: [] });

export class MiddlewareTraceStore {
  private data: TraceDatabase = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TraceDatabase;
      if (parsed.version !== 1 || !Array.isArray(parsed.traces)) {
        throw new Error("Unsupported middleware trace database format");
      }
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  list(filter: TraceFilter = {}): MiddlewareTrace[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    return structuredClone(this.data.traces)
      .filter((trace) => (filter.agentId ? trace.agentId === filter.agentId : true))
      .filter((trace) => (filter.runId ? trace.runId === filter.runId : true))
      .filter((trace) => (filter.status ? trace.status === filter.status : true))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  get(id: string): MiddlewareTrace | null {
    const trace = this.data.traces.find((item) => item.id === id);
    return trace ? structuredClone(trace) : null;
  }

  async insert(trace: MiddlewareTrace): Promise<void> {
    await this.mutate((database) => {
      database.traces.push(trace);
      if (database.traces.length > 2_000) {
        database.traces = database.traces
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 2_000);
      }
    });
  }

  async update(id: string, mutation: (trace: MiddlewareTrace) => void): Promise<void> {
    await this.mutate((database) => {
      const trace = database.traces.find((item) => item.id === id);
      if (!trace) return;
      mutation(trace);
    });
  }

  count(): number {
    return this.data.traces.length;
  }

  private async mutate(mutation: (database: TraceDatabase) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      mutation(next);
      await this.persist(next);
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }

  private async persist(data: TraceDatabase = this.data): Promise<void> {
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}