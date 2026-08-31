import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import { loadConfig, writeCodexConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";
import { JsonStore } from "./store.js";
import { LaunchpadMiddlewareAddon, registerMiddlewareRoutes } from "./middleware/index.js";
import { WorkspaceManager } from "./workspace.js";

const config = loadConfig();
await writeCodexConfig(config);

const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"));
const workspaces = new WorkspaceManager(config.workspaceRoot);
const middleware = await LaunchpadMiddlewareAddon.create({
  dataDirectory: config.dataDirectory,
  resolveRunId: (agentId: string) => {
    const activeRuns = store
      .snapshot()
      .runs.filter(
        (run) =>
          run.agentId === agentId &&
          (run.status === "queued" || run.status === "running"),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return activeRuns[0]?.id ?? null;
  },
});
const runner = middleware.wrapRunner(createRunner(config));
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

const app = await createApp(config, service);

await registerMiddlewareRoutes(app, middleware);
app.log.info("[middleware][bootstrap] SUCCESS additive middleware fully registered");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
