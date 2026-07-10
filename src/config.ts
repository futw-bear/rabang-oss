import type { FubonCredentials } from "./connectors/fubon-gateway-protocol.ts";

type Environment = Record<string, string | undefined>;

export function loadFubonCredentials(environment: Environment): FubonCredentials {
  const personalId = requireValue(environment, "FUBON_PERSONAL_ID");
  const certPath = requireValue(environment, "FUBON_CERT_PATH");
  const certPassword = environment.FUBON_CERT_PASSWORD || personalId;
  const password = environment.FUBON_PASSWORD;
  const apiKey = environment.FUBON_API_KEY;

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
    };
  }

  if (apiKey) {
    return {
      method: "apiKey",
      personalId,
      apiKey,
      certPath,
      certPassword,
    };
  }

  throw new Error("Set either FUBON_PASSWORD or FUBON_API_KEY");
}

export function loadPort(environment: Environment): number {
  const rawPort = environment.PORT ?? "3000";
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${rawPort}`);
  }

  return port;
}

function requireValue(environment: Environment, name: string): string {
  const value = environment[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
