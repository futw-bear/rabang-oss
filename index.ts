import {
  loadFubonCredentials,
  loadFubonOfflineRecoveryStrategy,
  loadPort,
} from "./src/config.ts";
import { FubonConnector } from "./src/connectors/fubon-connector.ts";
import { RetryingConnector } from "./src/connectors/retrying-connector.ts";
import { startHttpServer } from "./src/http/server.ts";

const connector = new FubonConnector(
  loadFubonCredentials(Bun.env),
  undefined,
  undefined,
  loadFubonOfflineRecoveryStrategy(Bun.env),
);
const server = startHttpServer(connector, loadPort(Bun.env));

console.log(`HTTP server listening on ${server.url}`);

const retryingConnector = new RetryingConnector(connector);
retryingConnector.start();
