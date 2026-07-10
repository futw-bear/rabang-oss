import type { Connector } from "../connectors/connector.ts";
import {
  FUBON_PROXY_ENDPOINTS,
  type FubonProxyEndpoint,
} from "../proxy/fubon-proxy-endpoints.ts";
import type {
  FubonProxyInvocation,
} from "../proxy/fubon-proxy-types.ts";

class InvalidProxyRequestError extends Error {}

export function createRequestHandler(
  connector: Connector,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      if (connector.status === "connected") {
        return Response.json({ status: "ok" }, { status: 200 });
      }

      return Response.json({ status: "attempting" }, { status: 503 });
    }

    const endpoint = FUBON_PROXY_ENDPOINTS.get(url.pathname);
    if (!endpoint) {
      return Response.json({ status: "not_found" }, { status: 404 });
    }

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
      const parameters =
        endpoint.httpMethod === "GET"
          ? readQueryParameters(url.searchParams)
          : await readJsonParameters(request);
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

function coerceOrderedParameter(name: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    (name === "quantity" || name === "lot" || name === "strikePrice")
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new InvalidProxyRequestError(
        `Parameter ${name} must be a number`,
      );
    }

    return number;
  }

  return value;
}
