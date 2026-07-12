import type { Connector } from "../connectors/connector.ts";
import type { FubonAccount } from "../connectors/fubon-connector.ts";
import {
  matchFubonProxyEndpoint,
  type FubonProxyEndpoint,
} from "../proxy/fubon-proxy-endpoints.ts";
import type { FubonProxyInvocation } from "../proxy/fubon-proxy-types.ts";
import { createBridgeRequestHandler } from "../bridge/bridge.ts";

class InvalidProxyRequestError extends Error {}

type AccountConnector = Connector & {
  readonly accounts: readonly FubonAccount[];
};

export function createRequestHandler(
  connector: AccountConnector,
): (request: Request) => Promise<Response> {
  const bridgeRequestHandler = createBridgeRequestHandler(connector);

  return async (request) => {
    const url = new URL(request.url);

    const bridgeResponse = await bridgeRequestHandler(request);
    if (bridgeResponse) {
      return bridgeResponse;
    }

    if (request.method === "GET" && url.pathname === "/") {
      if (connector.status === "connected") {
        return Response.json({ status: "ok" }, { status: 200 });
      }

      return Response.json({ status: "attempting" }, { status: 503 });
    }

    const matchedEndpoint = matchFubonProxyEndpoint(url.pathname);
    if (!matchedEndpoint) {
      return Response.json({ status: "not_found" }, { status: 404 });
    }

    const { endpoint, pathParameters } = matchedEndpoint;

    if (request.method !== endpoint.httpMethod) {
      return Response.json(
        { status: "method_not_allowed" },
        {
          status: 405,
          headers: { Allow: endpoint.httpMethod },
        },
      );
    }

    if (connector.status !== "connected") {
      return Response.json({ status: "attempting" }, { status: 503 });
    }

    try {
      const requestParameters =
        endpoint.httpMethod === "GET"
          ? readQueryParameters(url.searchParams)
          : await readJsonParameters(request);
      addAccountQueryParameter(
        requestParameters,
        endpoint.httpMethod,
        url.searchParams,
      );
      const parameters = mergePathParameters(requestParameters, pathParameters);
      selectAuthenticatedAccount(endpoint, parameters, connector.accounts);
      const invocation = createInvocation(endpoint, parameters);
      const result = await connector.invokeProxy(invocation);

      return Response.json(result);
    } catch (error) {
      if (error instanceof InvalidProxyRequestError) {
        return Response.json(
          { status: "invalid_request", message: error.message },
          { status: 400 },
        );
      }

      return Response.json(
        {
          status: "proxy_error",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 502 },
      );
    }
  };
}

function addAccountQueryParameter(
  parameters: Record<string, unknown>,
  method: string,
  searchParameters: URLSearchParams,
): void {
  if (method === "GET" || !searchParameters.has("account")) {
    return;
  }

  const rawAccount = searchParameters.get("account");
  if (rawAccount === null) {
    return;
  }

  const account = decodeQueryValue("account", rawAccount);
  if (Object.hasOwn(parameters, "account") && parameters.account !== account) {
    throw new InvalidProxyRequestError(
      "Query parameter account conflicts with the request body",
    );
  }

  parameters.account = account;
}

function readQueryParameters(
  searchParameters: URLSearchParams,
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};

  for (const [key, rawValue] of searchParameters) {
    const value = decodeQueryValue(key, rawValue);
    const existingValue = parameters[key];

    if (existingValue === undefined) {
      parameters[key] = value;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      parameters[key] = [existingValue, value];
    }
  }

  return parameters;
}

function decodeQueryValue(key: string, value: string): unknown {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      throw new InvalidProxyRequestError(
        `Query parameter ${key} must contain valid JSON`,
      );
    }
  }

  return value;
}

function mergePathParameters(
  parameters: Record<string, unknown>,
  pathParameters: Record<string, string>,
): Record<string, unknown> {
  for (const [name, value] of Object.entries(pathParameters)) {
    if (Object.hasOwn(parameters, name) && parameters[name] !== value) {
      throw new InvalidProxyRequestError(
        `Path parameter ${name} conflicts with the query parameter`,
      );
    }

    parameters[name] = value;
  }

  return parameters;
}

async function readJsonParameters(
  request: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;

  try {
    value = await request.json();
  } catch {
    throw new InvalidProxyRequestError("Request body must contain valid JSON");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidProxyRequestError("Request body must be a JSON object");
  }

  return value as Record<string, unknown>;
}

function createInvocation(
  endpoint: FubonProxyEndpoint,
  parameters: Record<string, unknown>,
): FubonProxyInvocation {
  if (endpoint.argumentStyle === "object") {
    return {
      target: endpoint.target,
      arguments: [parameters],
    };
  }

  const allowedParameterNames = new Set(endpoint.parameterNames);
  const unknownParameterName = Object.keys(parameters).find(
    (name) => !allowedParameterNames.has(name),
  );

  if (unknownParameterName) {
    throw new InvalidProxyRequestError(
      `Unknown parameter: ${unknownParameterName}`,
    );
  }

  for (const parameterName of endpoint.parameterNames.slice(
    0,
    endpoint.requiredParameterCount,
  )) {
    if (!Object.hasOwn(parameters, parameterName)) {
      throw new InvalidProxyRequestError(
        `Missing required parameter: ${parameterName}`,
      );
    }
  }

  const lastParameterIndex = endpoint.parameterNames.findLastIndex((name) =>
    Object.hasOwn(parameters, name),
  );
  const arguments_ = endpoint.parameterNames
    .slice(0, lastParameterIndex + 1)
    .map((name) => coerceOrderedParameter(name, parameters[name]));

  return {
    target: endpoint.target,
    arguments: arguments_,
  };
}

function selectAuthenticatedAccount(
  endpoint: FubonProxyEndpoint,
  parameters: Record<string, unknown>,
  accounts: readonly FubonAccount[],
): void {
  if (
    endpoint.argumentStyle !== "ordered" ||
    !endpoint.parameterNames.includes("account")
  ) {
    return;
  }

  const requestedAccount = parameters.account;
  if (
    requestedAccount !== undefined &&
    typeof requestedAccount !== "string" &&
    typeof requestedAccount !== "number"
  ) {
    return;
  }

  const accountIndex =
    requestedAccount === undefined ? 0 : parseAccountIndex(requestedAccount);
  const account = accounts[accountIndex];

  if (!account) {
    throw new InvalidProxyRequestError(
      `Authenticated account index is unavailable: ${accountIndex}`,
    );
  }

  parameters.account = account;
}

function parseAccountIndex(value: string | number): number {
  const index =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(index) || index < 0) {
    throw new InvalidProxyRequestError(
      "account must be a non-negative authenticated account index",
    );
  }

  return index;
}

function coerceOrderedParameter(name: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    (name === "quantity" || name === "lot" || name === "strikePrice")
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new InvalidProxyRequestError(`Parameter ${name} must be a number`);
    }

    return number;
  }

  return value;
}
