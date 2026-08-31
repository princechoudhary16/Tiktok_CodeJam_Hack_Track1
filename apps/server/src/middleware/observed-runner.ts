import { randomUUID } from "node:crypto";
import type { AgentRunner, RunnerRequest, RunnerResult } from "../types.js";
import { MiddlewarePolicyDeniedError, evaluatePromptPolicy } from "./policy.js";
import { summarizeSafely } from "./redaction.js";
import { MiddlewareTraceStore } from "./trace-store.js";
import { WorkspaceCheckpointManager } from "./workspace-checkpoints.js";
import type { MiddlewareLogger, MiddlewareSpan, MiddlewareTrace } from "./types.js";

const now = () => new Date().toISOString();

function elapsedMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

export class ObservedAgentRunner implements AgentRunner {
  constructor(
    private readonly inner: AgentRunner,
    private readonly store: MiddlewareTraceStore,
    private readonly checkpoints: WorkspaceCheckpointManager,
    private readonly resolveRunId: (agentId: string) => string | null,
    private readonly logger: MiddlewareLogger,
  ) {}

  async run(request: RunnerRequest): Promise<RunnerResult> {
    const traceId = randomUUID();
    const startedAt = now();
    let runId: string | null = null;

    try {
      runId = this.resolveRunId(request.agentId);
    } catch (error) {
      this.logger.warn(
        `[middleware][correlation] WARN traceId=${traceId} agentId=${request.agentId} unable-to-resolve-run-id error=${summarizeSafely(String(error), 180)}`,
      );
    }

    const evaluation = evaluatePromptPolicy(request.prompt);
    const policyCompletedAt = now();
    const policySpan: MiddlewareSpan = {
      id: randomUUID(),
      category: "policy",
      name: "prompt-safety-policy",
      status: evaluation.allowed ? "completed" : "denied",
      startedAt,
      completedAt: policyCompletedAt,
      durationMs: elapsedMs(startedAt, policyCompletedAt),
      detail: evaluation.allowed
        ? "Prompt accepted by middleware policy."
        : `Denied by rule ${evaluation.ruleId ?? "unknown"}.`,
    };

    const trace: MiddlewareTrace = {
      id: traceId,
      runId,
      agentId: request.agentId,
      workspacePath: request.workspacePath,
      threadId: request.threadId,
      status: evaluation.allowed ? "running" : "denied",
      createdAt: startedAt,
      completedAt: evaluation.allowed ? null : policyCompletedAt,
      durationMs: evaluation.allowed ? null : elapsedMs(startedAt, policyCompletedAt),
      inputSummary: summarizeSafely(request.prompt),
      outputSummary: null,
      errorSummary: evaluation.allowed ? null : evaluation.reason,
      recovery: {
        snapshotPath: null,
        createdAt: null,
        restoredAt: null,
      },
      policy: {
        decision: evaluation.allowed ? "allow" : "deny",
        ruleId: evaluation.ruleId,
        reason: evaluation.reason,
        evaluatedAt: policyCompletedAt,
      },
      spans: [
        {
          id: randomUUID(),
          category: "orchestration",
          name: "agent-run-middleware",
          status: evaluation.allowed ? "running" : "denied",
          startedAt,
          completedAt: evaluation.allowed ? null : policyCompletedAt,
          durationMs: evaluation.allowed ? null : elapsedMs(startedAt, policyCompletedAt),
          detail: runId ? `Correlated to Agent Run ${runId}.` : "Run ID correlation unavailable.",
        },
        policySpan,
      ],
    };

    await this.store.insert(trace);
    this.logger.info(
      `[middleware][trace] START traceId=${traceId} runId=${runId ?? "unresolved"} agentId=${request.agentId}`,
    );

    if (!evaluation.allowed) {
      this.logger.warn(
        `[middleware][policy] DENIED traceId=${traceId} rule=${evaluation.ruleId ?? "unknown"} SUCCESS=policy-blocked-before-runtime`,
      );
      throw new MiddlewarePolicyDeniedError(
        evaluation.ruleId ?? "unknown",
        `Blocked by middleware policy (${evaluation.ruleId ?? "unknown"}): ${evaluation.reason}`,
      );
    }

    this.logger.info(
      `[middleware][policy] PASS traceId=${traceId} SUCCESS=policy-check-completed`,
    );

    const checkpoint = await this.checkpoints.createSnapshot(
      request.agentId,
      request.workspacePath,
      traceId,
    );
    await this.store.update(traceId, (stored) => {
      stored.recovery.snapshotPath = checkpoint.snapshotPath;
      stored.recovery.createdAt = checkpoint.createdAt;
      stored.spans.push({
        id: randomUUID(),
        category: "recovery",
        name: "workspace-checkpoint-captured",
        status: "completed",
        startedAt: checkpoint.createdAt,
        completedAt: checkpoint.createdAt,
        durationMs: 0,
        detail: `Checkpoint captured at ${checkpoint.snapshotPath}.`,
      });
    });

    const runtimeStartedAt = now();
    const runtimeSpanId = randomUUID();
    await this.store.update(traceId, (stored) => {
      stored.spans.push({
        id: runtimeSpanId,
        category: "runtime",
        name: "agent-runner.run",
        status: "running",
        startedAt: runtimeStartedAt,
        completedAt: null,
        durationMs: null,
        detail: "Delegated to the existing AgentRunner implementation.",
      });
    });

    try {
      const result = await this.inner.run(request);
      const completedAt = now();
      await this.store.update(traceId, (stored) => {
        stored.status = "completed";
        stored.completedAt = completedAt;
        stored.durationMs = elapsedMs(startedAt, completedAt);
        stored.outputSummary = summarizeSafely(result.output);
        stored.errorSummary = null;
        const runtimeSpan = stored.spans.find((span) => span.id === runtimeSpanId);
        if (runtimeSpan) {
          runtimeSpan.status = "completed";
          runtimeSpan.completedAt = completedAt;
          runtimeSpan.durationMs = elapsedMs(runtimeStartedAt, completedAt);
          runtimeSpan.detail = result.usage
            ? `Runtime completed; token usage metadata was returned.`
            : "Runtime completed; no token usage metadata was returned.";
        }
        const orchestrationSpan = stored.spans.find(
          (span) => span.category === "orchestration",
        );
        if (orchestrationSpan) {
          orchestrationSpan.status = "completed";
          orchestrationSpan.completedAt = completedAt;
          orchestrationSpan.durationMs = elapsedMs(startedAt, completedAt);
        }
      });
      this.logger.info(
        `[middleware][runtime] SUCCESS traceId=${traceId} runId=${runId ?? "unresolved"} durationMs=${elapsedMs(startedAt, completedAt)}`,
      );
      this.logger.info(
        `[middleware][trace-store] SUCCESS traceId=${traceId} persisted=completed`,
      );
      return result;
    } catch (error) {
      const completedAt = now();
      const errorSummary = summarizeSafely(error instanceof Error ? error.message : String(error));
      let recoveredAt: string | null = null;
      let recoveryError: string | null = null;
      if (checkpoint?.snapshotPath) {
        try {
          await this.checkpoints.restoreSnapshot(checkpoint.snapshotPath, request.workspacePath);
          recoveredAt = now();
        } catch (recoveryErrorValue) {
          recoveryError = summarizeSafely(
            recoveryErrorValue instanceof Error ? recoveryErrorValue.message : String(recoveryErrorValue),
          );
        }
      }
      await this.store.update(traceId, (stored) => {
        stored.status = recoveredAt ? "recovered" : "failed";
        stored.completedAt = recoveredAt ?? completedAt;
        stored.durationMs = elapsedMs(startedAt, recoveredAt ?? completedAt);
        stored.errorSummary = errorSummary;
        if (recoveredAt) {
          stored.recovery.restoredAt = recoveredAt;
          stored.spans.push({
            id: randomUUID(),
            category: "recovery",
            name: "workspace-auto-recovered",
            status: "completed",
            startedAt: completedAt,
            completedAt: recoveredAt,
            durationMs: elapsedMs(completedAt, recoveredAt),
            detail: `Workspace restored from ${checkpoint?.snapshotPath ?? "unavailable"}.`,
          });
        }
        const runtimeSpan = stored.spans.find((span) => span.id === runtimeSpanId);
        if (runtimeSpan) {
          runtimeSpan.status = recoveredAt ? "completed" : "failed";
          runtimeSpan.completedAt = recoveredAt ?? completedAt;
          runtimeSpan.durationMs = elapsedMs(runtimeStartedAt, recoveredAt ?? completedAt);
          runtimeSpan.detail = errorSummary;
        }
        const orchestrationSpan = stored.spans.find(
          (span) => span.category === "orchestration",
        );
        if (orchestrationSpan) {
          orchestrationSpan.status = recoveredAt ? "completed" : "failed";
          orchestrationSpan.completedAt = recoveredAt ?? completedAt;
          orchestrationSpan.durationMs = elapsedMs(startedAt, recoveredAt ?? completedAt);
        }
      });
      if (recoveredAt) {
        this.logger.info(
          `[middleware][recovery] AUTO-SUCCESS traceId=${traceId} runId=${runId ?? "unresolved"} restoredAt=${recoveredAt}`,
        );
      } else if (recoveryError) {
        this.logger.warn(
          `[middleware][recovery] AUTO-FAILED traceId=${traceId} runId=${runId ?? "unresolved"} error=${recoveryError}`,
        );
      }
      this.logger.error(
        `[middleware][runtime] FAILURE traceId=${traceId} runId=${runId ?? "unresolved"} error=${errorSummary}`,
      );
      throw error;
    }
  }

  async cancel(agentId: string): Promise<boolean> {
    const startedAt = now();
    const result = await this.inner.cancel(agentId);
    const completedAt = now();
    const active = this.store
      .list({ agentId, status: "running", limit: 1 })
      .at(0);

    if (active) {
      await this.store.update(active.id, (trace) => {
        trace.status = "cancelled";
        trace.completedAt = completedAt;
        trace.durationMs = elapsedMs(trace.createdAt, completedAt);
        trace.spans.push({
          id: randomUUID(),
          category: "cancellation",
          name: "agent-runner.cancel",
          status: "cancelled",
          startedAt,
          completedAt,
          durationMs: elapsedMs(startedAt, completedAt),
          detail: result ? "Underlying runner acknowledged cancellation." : "No active runner process acknowledged cancellation.",
        });
        const orchestrationSpan = trace.spans.find(
          (span) => span.category === "orchestration",
        );
        if (orchestrationSpan && orchestrationSpan.status === "running") {
          orchestrationSpan.status = "cancelled";
          orchestrationSpan.completedAt = completedAt;
          orchestrationSpan.durationMs = elapsedMs(trace.createdAt, completedAt);
        }
      });
      this.logger.info(
        `[middleware][cancel] SUCCESS traceId=${active.id} agentId=${agentId} acknowledged=${String(result)}`,
      );
    }

    return result;
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }
}