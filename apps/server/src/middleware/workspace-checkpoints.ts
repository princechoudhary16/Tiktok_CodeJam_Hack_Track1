import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

function shouldSkipSnapshotEntry(entryPath: string): boolean {
  const segments = entryPath.split(path.sep);
  return segments.includes("node_modules") || segments.includes("dist");
}

export interface WorkspaceCheckpoint {
  snapshotPath: string;
  createdAt: string;
}

export class WorkspaceCheckpointManager {
  constructor(private readonly rootDirectory: string) {}

  private snapshotPath(agentId: string, traceId: string): string {
    return path.join(this.rootDirectory, agentId, traceId);
  }

  async createSnapshot(agentId: string, workspacePath: string, traceId: string): Promise<WorkspaceCheckpoint> {
    const snapshotPath = this.snapshotPath(agentId, traceId);
    await rm(snapshotPath, { recursive: true, force: true });
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await cp(workspacePath, snapshotPath, {
      recursive: true,
      preserveTimestamps: true,
      filter: (sourcePath) => !shouldSkipSnapshotEntry(sourcePath),
    });
    return { snapshotPath, createdAt: new Date().toISOString() };
  }

  async restoreSnapshot(snapshotPath: string, workspacePath: string): Promise<void> {
    await rm(workspacePath, { recursive: true, force: true });
    await mkdir(path.dirname(workspacePath), { recursive: true });
    await cp(snapshotPath, workspacePath, {
      recursive: true,
      preserveTimestamps: true,
    });
  }
}