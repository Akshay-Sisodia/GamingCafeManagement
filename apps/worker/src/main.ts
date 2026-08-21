// Standalone worker deployable — same codebase as the API, separate process.
import { startWorker } from "../../server/src/worker.js";

void startWorker().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
