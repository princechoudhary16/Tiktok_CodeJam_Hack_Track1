import type { FastifyInstance } from "fastify";
import { MIDDLEWARE_DASHBOARD_HTML } from "./dashboard.js";
import type { LaunchpadMiddlewareAddon } from "./addon.js";
import type { TraceStatus } from "./types.js";

const VALID_STATUSES = new Set<TraceStatus>([
  "running",
  "completed",
  "failed",
  "denied",
  "cancelled",
  "recovered",
]);

export async function registerMiddlewareRoutes(
  app: FastifyInstance,
  middleware: LaunchpadMiddlewareAddon,
): Promise<void> {
  app.get("/api/middleware/health", async () => middleware.health());

  app.get("/api/middleware/traces", async (request, reply) => {
    const query = request.query as {
      agentId?: string;
      runId?: string;
      status?: string;
      limit?: string;
    };

    const status = query.status && VALID_STATUSES.has(query.status as TraceStatus)
      ? (query.status as TraceStatus)
      : undefined;
    const parsedLimit = query.limit ? Number.parseInt(query.limit, 10) : undefined;

    if (query.status && !status) {
      return reply.code(400).send({ error: "Invalid middleware trace status" });
    }
    if (query.limit && (!Number.isFinite(parsedLimit) || (parsedLimit ?? 0) < 1)) {
      return reply.code(400).send({ error: "limit must be a positive integer" });
    }

    return {
      traces: middleware.listTraces({
        ...(query.agentId ? { agentId: query.agentId } : {}),
        ...(query.runId ? { runId: query.runId } : {}),
        ...(status ? { status } : {}),
        ...(parsedLimit ? { limit: parsedLimit } : {}),
      }),
    };
  });

  app.get("/api/middleware/traces/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const trace = middleware.getTrace(id);
    if (!trace) return reply.code(404).send({ error: "Middleware trace not found" });
    return { trace };
  });

  app.post("/api/middleware/traces/:id/recover", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return { recovery: await middleware.recoverTrace(id) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recovery failed";
      const statusCode = message === "Middleware trace not found" ? 404 : 409;
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.get("/middleware", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(MIDDLEWARE_DASHBOARD_HTML);
  });

  app.log.info(
    "[middleware][routes] SUCCESS registered=/api/middleware/health,/api/middleware/traces,/api/middleware/traces/:id/recover,/middleware",
  );
}