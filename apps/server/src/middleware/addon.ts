import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentRunner } from "../types.js";
import { ObservedAgentRunner } from "./observed-runner.js";
import { MiddlewareTraceStore } from "./trace-store.js";
import { WorkspaceCheckpointManager } from "./workspace-checkpoints.js";
import type {
  MiddlewareAddon,
  MiddlewareAddonOptions,
  MiddlewareLogger,
  MiddlewareRecoveryResult,
  MiddlewareTrace,
  TraceFilter,
} from "./types.js";

const defaultLogger: MiddlewareLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export class LaunchpadMiddlewareAddon implements MiddlewareAddon {
  private constructor(
    private readonly store: MiddlewareTraceStore,
    private readonly checkpoints: WorkspaceCheckpointManager,
    private readonly resolveRunId: (agentId: string) => string | null,
    private readonly logger: MiddlewareLogger,
  ) {}

  static async create(options: MiddlewareAddonOptions): Promise<LaunchpadMiddlewareAddon> {
    const middlewareDirectory = path.join(options.dataDirectory, "middleware");
    const store = new MiddlewareTraceStore(
      path.join(middlewareDirectory, "traces.json"),
    );
    const checkpoints = new WorkspaceCheckpointManager(
      path.join(middlewareDirectory, "checkpoints"),
    );
    await store.initialize();
    const logger = options.logger ?? defaultLogger;
    logger.info(
      `[middleware][bootstrap] SUCCESS trace-store-ready path=${path.join(middlewareDirectory, "traces.json")}`,
    );
    return new LaunchpadMiddlewareAddon(store, checkpoints, options.resolveRunId, logger);
  }

  wrapRunner(inner: AgentRunner): AgentRunner {
    this.logger.info(
      "[middleware][bootstrap] SUCCESS existing-AgentRunner-wrapped=true",
    );
    return new ObservedAgentRunner(inner, this.store, this.checkpoints, this.resolveRunId, this.logger);
  }

  listTraces(filter: TraceFilter = {}): MiddlewareTrace[] {
    return this.store.list(filter);
  }

  getTrace(id: string): MiddlewareTrace | null {
    return this.store.get(id);
  }

  async recoverTrace(id: string): Promise<MiddlewareRecoveryResult> {
    const trace = this.store.get(id);
    if (!trace) {
      throw new Error("Middleware trace not found");
    }
    if (!trace.recovery.snapshotPath) {
      throw new Error("No recovery snapshot available for this trace");
    }
    if (trace.recovery.restoredAt) {
      return {
        traceId: trace.id,
        agentId: trace.agentId,
        workspacePath: trace.workspacePath,
        snapshotPath: trace.recovery.snapshotPath,
        restoredAt: trace.recovery.restoredAt,
      };
    }

    const restoredAt = new Date().toISOString();
    await this.checkpoints.restoreSnapshot(trace.recovery.snapshotPath, trace.workspacePath);
    await this.store.update(id, (stored) => {
      stored.status = "recovered";
      stored.completedAt = restoredAt;
      stored.durationMs = Math.max(0, Date.parse(restoredAt) - Date.parse(stored.createdAt));
      stored.recovery.restoredAt = restoredAt;
      stored.spans.push({
        id: randomUUID(),
        category: "recovery",
        name: "workspace-rollback-applied",
        status: "completed",
        startedAt: restoredAt,
        completedAt: restoredAt,
        durationMs: 0,
        detail: `Workspace restored from ${trace.recovery.snapshotPath}.`,
      });
    });

    this.logger.info(
      `[middleware][recovery] SUCCESS traceId=${id} workspacePath=${trace.workspacePath} restoredAt=${restoredAt}`,
    );

    return {
      traceId: trace.id,
      agentId: trace.agentId,
      workspacePath: trace.workspacePath,
      snapshotPath: trace.recovery.snapshotPath,
      restoredAt,
    };
  }

  health() {
    return {
      ok: true as const,
      service: "agent-launchpad-middleware" as const,
      capabilities: [
        "runtime-trace-and-audit",
        "prompt-safety-policy",
        "secret-redaction",
        "failure-and-cancellation-evidence",
        "automatic-workspace-recovery",
        "workspace-snapshot-and-rollback",
      ],
      traceCount: this.store.count(),
    };
  }
}