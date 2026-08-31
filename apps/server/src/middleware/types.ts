import type { AgentRunner } from "../types.js";

export type TraceStatus = "running" | "completed" | "failed" | "denied" | "cancelled" | "recovered";
export type SpanStatus = "running" | "completed" | "failed" | "denied" | "cancelled";

export interface MiddlewarePolicyDecision {
  decision: "allow" | "deny";
  ruleId: string | null;
  reason: string;
  evaluatedAt: string;
}

export interface MiddlewareSpan {
  id: string;
  category: "orchestration" | "policy" | "runtime" | "cancellation" | "recovery";
  name: string;
  status: SpanStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  detail: string | null;
}

export interface MiddlewareRecoveryState {
  snapshotPath: string | null;
  createdAt: string | null;
  restoredAt: string | null;
}

export interface MiddlewareTrace {
  id: string;
  runId: string | null;
  agentId: string;
  workspacePath: string;
  threadId: string | null;
  status: TraceStatus;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  inputSummary: string;
  outputSummary: string | null;
  errorSummary: string | null;
  policy: MiddlewarePolicyDecision;
  recovery: MiddlewareRecoveryState;
  spans: MiddlewareSpan[];
}

export interface TraceDatabase {
  version: 1;
  traces: MiddlewareTrace[];
}

export interface TraceFilter {
  agentId?: string;
  runId?: string;
  status?: TraceStatus;
  limit?: number;
}

export interface MiddlewareLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MiddlewareAddonOptions {
  dataDirectory: string;
  resolveRunId: (agentId: string) => string | null;
  logger?: MiddlewareLogger;
}

export interface MiddlewareRecoveryResult {
  traceId: string;
  agentId: string;
  workspacePath: string;
  snapshotPath: string;
  restoredAt: string;
}

export interface MiddlewareAddon {
  wrapRunner(inner: AgentRunner): AgentRunner;
  listTraces(filter?: TraceFilter): MiddlewareTrace[];
  getTrace(id: string): MiddlewareTrace | null;
  recoverTrace(id: string): Promise<MiddlewareRecoveryResult>;
  health(): {
    ok: true;
    service: "agent-launchpad-middleware";
    capabilities: string[];
    traceCount: number;
  };
}