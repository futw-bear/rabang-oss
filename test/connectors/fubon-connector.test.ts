import { describe, expect, test } from "bun:test";
import {
  FubonConnector,
  FubonGatewayClient,
  type FubonCredentials,
  type FubonGateway,
  type GatewayProcessFactory,
} from "../../src/connectors/fubon-connector.ts";
import type {
  FubonGatewayCommandMap,
  FubonGatewayEvent,
  FubonGatewayMethod,
  FubonGatewayRequest,
} from "../../src/connectors/fubon-gateway-protocol.ts";

const credentials: FubonCredentials = {
  method: "password",
  personalId: "personal-id",
  password: "password",
  certPath: "/cert.pfx",
  certPassword: "cert-password",
};

const noOpLogger = { info: () => {} };

describe("FubonConnector", () => {
  test("logs in through the gateway and stores the accounts", async () => {
    const gateway = new FakeGateway();
    const infoLogs: unknown[][] = [];
    const connector = new FubonConnector(credentials, gateway, {
      info: (...arguments_) => infoLogs.push(arguments_),
    });

    expect(connector.status).toBe("attempting");

    await connector.connect();

    expect(connector.status).toBe("connected");
    expect(connector.accounts).toEqual([
      {
        name: "Test Account",
        branchNo: "1234",
        account: "567890",
        accountType: "stock",
      },
    ]);
    expect(gateway.loginCredentials).toEqual(credentials);
    expect(gateway.requestedMethods).toEqual(["login", "getAccounts"]);
    expect(infoLogs).toEqual([
      ["Fubon accounts available", [...connector.accounts]],
    ]);
  });

  test("remains attempting after a failed gateway login", async () => {
    const gateway = new FakeGateway();
    gateway.loginError = new Error("Login failed");
    const connector = new FubonConnector(credentials, gateway, noOpLogger);

    await expect(connector.connect()).rejects.toThrow("Login failed");
    expect(connector.status).toBe("attempting");
  });

  test("forwards typed requests after connecting", async () => {
    const gateway = new FakeGateway();
    const connector = new FubonConnector(credentials, gateway, noOpLogger);
    await connector.connect();

    const result = await connector.request("getAccounts", {});

    expect(result.accounts).toEqual([...connector.accounts]);
  });

  test("forwards proxy invocations after connecting", async () => {
    const gateway = new FakeGateway();
    const connector = new FubonConnector(credentials, gateway, noOpLogger);
    await connector.connect();

    const invocation = {
      target: {
        service: "marketDataStock" as const,
        methodPath: ["intraday", "ticker"],
      },
      arguments: [{ symbol: "2330" }],
    };
    await connector.invokeProxy(invocation);

    expect(gateway.proxyInvocation).toEqual(invocation);
    expect(gateway.requestedMethods).toEqual([
      "login",
      "getAccounts",
      "invoke",
    ]);
  });

  test("returns to attempting when the gateway exits", async () => {
    const gateway = new FakeGateway();
    const connector = new FubonConnector(credentials, gateway, noOpLogger);
    let disconnects = 0;
    connector.onDisconnect(() => {
      disconnects += 1;
    });
    await connector.connect();

    gateway.emitExit(new Error("Gateway crashed"));

    expect(connector.status).toBe("attempting");
    expect(connector.accounts).toEqual([]);
    expect(disconnects).toBe(1);
  });
});

describe("FubonGatewayClient", () => {
  test("correlates typed requests and responses by request ID", async () => {
    const process = new FakeGatewayProcess();
    const client = new FubonGatewayClient(1_000, process.factory);
    const started = client.start();
    process.emitMessage({ type: "ready" });
    await started;

    const resultPromise = client.request("getAccounts", {});
    await Bun.sleep(0);
    const request = process.sentMessages[0] as FubonGatewayRequest<"getAccounts">;
    process.emitMessage({
      type: "response",
      id: request.id,
      ok: true,
      data: { accounts: [] },
    });

    await expect(resultPromise).resolves.toEqual({ accounts: [] });
    expect(request.method).toBe("getAccounts");
  });

  test("rejects pending requests when the gateway exits", async () => {
    const process = new FakeGatewayProcess();
    const client = new FubonGatewayClient(1_000, process.factory);
    const started = client.start();
    process.emitMessage({ type: "ready" });
    await started;

    const resultPromise = client.request("getAccounts", {});
    await Bun.sleep(0);
    process.emitExit(new Error("Gateway crashed"));

    await expect(resultPromise).rejects.toThrow("Gateway crashed");
  });

  test("times out requests that receive no response", async () => {
    const process = new FakeGatewayProcess();
    const client = new FubonGatewayClient(5, process.factory);
    const started = client.start();
    process.emitMessage({ type: "ready" });
    await started;

    await expect(client.request("getAccounts", {})).rejects.toThrow(
      "Fubon gateway request timed out: getAccounts",
    );
  });

  test("times out when the gateway never becomes ready", async () => {
    const process = new FakeGatewayProcess();
    const client = new FubonGatewayClient(5, process.factory);

    await expect(client.start()).rejects.toThrow(
      "Fubon gateway startup timed out",
    );
  });
});

class FakeGateway implements FubonGateway {
  isRunning = true;
  loginCredentials: FubonCredentials | undefined;
  loginError: Error | undefined;
  proxyInvocation: FubonGatewayCommandMap["invoke"]["request"] | undefined;
  requestedMethods: FubonGatewayMethod[] = [];
  readonly accounts = [
    {
      name: "Test Account",
      branchNo: "1234",
      account: "567890",
      accountType: "stock",
    },
  ];
  #eventListeners = new Set<(event: FubonGatewayEvent) => void>();
  #exitListeners = new Set<(error: Error) => void>();

  async start(): Promise<void> {}

  async request<M extends FubonGatewayMethod>(
    method: M,
    payload: FubonGatewayCommandMap[M]["request"],
  ): Promise<FubonGatewayCommandMap[M]["response"]> {
    this.requestedMethods.push(method);

    if (method === "login") {
      this.loginCredentials = (
        payload as FubonGatewayCommandMap["login"]["request"]
      ).credentials;

      if (this.loginError) {
        throw this.loginError;
      }
    }

    if (method === "logout") {
      return { success: true } as FubonGatewayCommandMap[M]["response"];
    }

    if (method === "invoke") {
      this.proxyInvocation = payload as FubonGatewayCommandMap["invoke"]["request"];
      return { ok: true } as FubonGatewayCommandMap[M]["response"];
    }

    return { accounts: this.accounts } as FubonGatewayCommandMap[M]["response"];
  }

  onEvent(listener: (event: FubonGatewayEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  async close(): Promise<void> {}

  emitExit(error: Error): void {
    for (const listener of this.#exitListeners) {
      listener(error);
    }
  }
}

class FakeGatewayProcess {
  sentMessages: unknown[] = [];
  #handlers: Parameters<GatewayProcessFactory>[0] | undefined;

  factory: GatewayProcessFactory = (handlers) => {
    this.#handlers = handlers;
    return {
      send: (message) => this.sentMessages.push(message),
      kill: () => {},
    };
  };

  emitMessage(message: unknown): void {
    this.#handlers?.onMessage(message);
  }

  emitExit(error: Error): void {
    this.#handlers?.onExit(error);
  }
}
