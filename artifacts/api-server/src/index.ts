import app from "./app";
import { logger } from "./lib/logger";
import { seedStarterStrategies } from "./lib/strategies/starters";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // One-time, idempotent seed of the engine-DISABLED starter strategies.
  // Fire-and-forget: never block or crash startup on a seed failure.
  seedStarterStrategies()
    .then((r) => {
      if (r.seeded && r.ids.length > 0) {
        logger.info({ ids: r.ids }, "Seeded starter strategies (engine-disabled)");
      }
    })
    .catch((err) => logger.warn({ err }, "Starter-strategy seed failed (non-fatal)"));
});
