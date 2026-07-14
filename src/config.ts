import type { FubonCredentials } from "./connectors/fubon-gateway-protocol.ts";
import type { FubonOfflineRecoveryStrategy } from "./connectors/fubon-connector.ts";

type Environment = Record<string, string | undefined>;

const TEST_ENVIRONMENT_DEFAULTS = {
  personalId: "41610792",
  password: "12345678",
  certPath: "./certs/41610792.pfx",
  certPassword: "12345678",
};

export function loadFubonCredentials(
  environment: Environment,
): FubonCredentials {
  const testEnvironment = environment.FUBON_TESTENV === "1";

  if (testEnvironment) {
    return {
      method: "password",
      ...TEST_ENVIRONMENT_DEFAULTS,
      testEnvironment: true,
    };
  }

  const apiKey = environment.FUBON_API_KEY;
  const personalId = requireValue(
    environment.FUBON_PERSONAL_ID,
    "FUBON_PERSONAL_ID",
  );
  const certPath = requireValue(environment.FUBON_CERT_PATH, "FUBON_CERT_PATH");
  const certPassword = environment.FUBON_CERT_PASSWORD || personalId;
  const password = environment.FUBON_PASSWORD;

  if (password && apiKey) {
    throw new Error("Set either FUBON_PASSWORD or FUBON_API_KEY, but not both");
  }

  if (password) {
    return {
      method: "password",
      personalId,
      password,
      certPath,
      certPassword,
      testEnvironment: false,
    };
  }

  if (apiKey) {
    return {
      method: "apiKey",
      personalId,
      apiKey,
      certPath,
      certPassword,
      testEnvironment: false,
    };
  }

  throw new Error("Set either FUBON_PASSWORD or FUBON_API_KEY");
}

export function loadPort(environment: Environment): number {
  const rawPort = environment.PORT ?? "4000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  return port;
}

export function loadDatabasePath(environment: Environment): string {
  const path = environment.RABANG_DATABASE_PATH ?? "./rabang.sqlite";
  if (path.trim().length === 0) {
    throw new Error("RABANG_DATABASE_PATH must not be empty");
  }
  return path;
}

export function loadFubonOfflineRecoveryStrategy(
  environment: Environment,
): FubonOfflineRecoveryStrategy {
  const strategy = environment.SERVER_GATEWAY_RECOVERY ?? "relogin";

  if (strategy === "relogin") {
    return "relogin";
  }

  if (strategy === "restart-gateway") {
    return "restartGateway";
  }

  throw new Error(
    `Invalid SERVER_GATEWAY_RECOVERY: ${strategy}; expected relogin or restart-gateway`,
  );
}

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
