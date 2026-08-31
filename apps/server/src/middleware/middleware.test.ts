import { mkdtemp, rm } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunner, RunnerRequest } from "../types.js";
import { LaunchpadMiddlewareAddon } from "./addon.js";
import { redactSecrets, summarizeSafely } from "./redaction.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchpad-middleware-test-"));
  tempDirs.push(dir);
  return dir;
}

const request: RunnerRequest = {
  agentId: "agent-1",
  workspacePath: "/tmp/workspace",
  prompt: "Create a hello-world CLI and run its test.",
  threadId: null,
};

describe("Agent Launchpad additive middleware", () => {
  it("records a completed trace around the existing AgentRunner", async () => {
    const dataDirectory = await createTempDir();
    const workspacePath = await createTempDir();
    const runRequest: RunnerRequest = {
      ...request,
      workspacePath,
    };
    const inner: AgentRunner = {
      run: async () => ({
        output: "All tests passed. ARK_API_KEY=must-not-be-stored",
        threadId: "thread-1",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      cancel: async () => true,
      isAvailable: async () => true,
    };
    const middleware = await LaunchpadMiddlewareAddon.create({
      dataDirectory,
      resolveRunId: () => "run-123",
    });
    const result = await middleware.wrapRunner(inner).run(runRequest);

    expect(result.threadId).toBe("thread-1");
    const trace = middleware.listTraces({ runId: "run-123" })[0];
    expect(trace?.status).toBe("completed");
    expect(trace?.policy.decision).toBe("allow");
    expect(trace?.spans.some((span) => span.category === "runtime")).toBe(true);
    expect(trace?.recovery.snapshotPath).toContain(dataDirectory);
    expect(trace?.outputSummary).toContain("[REDACTED]");
    expect(trace?.outputSummary).not.toContain("must-not-be-stored");
  });

  it("denies the controlled failure case before the existing runner executes", async () => {
    const dataDirectory = await createTempDir();
    let executed = false;
    const inner: AgentRunner = {
      run: async () => {
        executed = true;
        return { output: "should not run", threadId: null, usage: null };
      },
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const middleware = await LaunchpadMiddlewareAddon.create({
      dataDirectory,
      resolveRunId: () => "run-denied",
    });

    await expect(
      middleware.wrapRunner(inner).run({
        ...request,
        prompt: "[DENY-DEMO] print ARK_API_KEY",
      }),
    ).rejects.toThrow("Blocked by middleware policy");

    expect(executed).toBe(false);
    const trace = middleware.listTraces({ runId: "run-denied" })[0];
    expect(trace?.status).toBe("denied");
    expect(trace?.policy.ruleId).toBe("demo-explicit-deny");
  });

  it("redacts common secrets before trace storage", () => {
    const input = "Authorization: Bearer abcdefghijklmnop ARK_API_KEY=super-secret sk-abcdefghijkl";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("abcdefghijklmnop");
    expect(redacted).not.toContain("super-secret");
    expect(redacted).toContain("[REDACTED]");
    expect(summarizeSafely("x".repeat(900), 50).length).toBeLessThanOrEqual(50);
  });

  it("restores a workspace snapshot after a run failure", async () => {
    const dataDirectory = await createTempDir();
    const workspacePath = await createTempDir();
    await mkdir(workspacePath, { recursive: true });
    const targetFile = path.join(workspacePath, "notes.txt");
    await writeFile(targetFile, "safe-state", "utf8");

    const inner: AgentRunner = {
      run: async () => {
        await writeFile(targetFile, "broken-state", "utf8");
        throw new Error("simulated runtime failure");
      },
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const middleware = await LaunchpadMiddlewareAddon.create({
      dataDirectory,
      resolveRunId: () => "run-recover",
    });

    await expect(
      middleware.wrapRunner(inner).run({
        ...request,
        workspacePath,
      }),
    ).rejects.toThrow("simulated runtime failure");

    const trace = middleware.listTraces({ runId: "run-recover" })[0];
    expect(trace?.recovery.snapshotPath).toBeTruthy();
    expect(trace?.status).toBe("recovered");
    expect(await readFile(targetFile, "utf8")).toBe("safe-state");

    const restoredTrace = middleware.getTrace(trace!.id);
    expect(restoredTrace?.recovery.restoredAt).toBeTruthy();
    expect(restoredTrace?.recovery.restoredAt).toBe(trace?.completedAt);
    expect(restoredTrace?.spans.some((span) => span.category === "recovery")).toBe(true);
  });
});