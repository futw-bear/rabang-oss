import type { Connector, ConnectorStatus } from "./connector.ts";
import type {
  FubonProxyInvocation,
  MarketDataWebSocketMessage,
  MarketDataWebSocketMode,
} from "../proxy/fubon-proxy-types.ts";
import {
  isFubonGatewayMessage,
  type FubonAccount,
  type FubonCredentials,
  type FubonGatewayCommandMap,
  type FubonGatewayEvent,
  type FubonGatewayMessage,
  type FubonGatewayMethod,
  type FubonGatewayRequest,
} from "./fubon-gateway-protocol.ts";

export type {
  FubonAccount,
  FubonApiKeyCredentials,
  FubonCredentials,
  FubonPasswordCredentials,
} from "./fubon-gateway-protocol.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type GatewayEventListener = (event: FubonGatewayEvent) => void;
type GatewayExitListener = (error: Error) => void;
type DisconnectListener = () => void;
type MarketDataWebSocketListener = (
  message: MarketDataWebSocketMessage,
) => void;
export type FubonTradingEvent = Extract<
  FubonGatewayEvent,
  { event: "trading" }
>["data"];
type TradingEventListener = (event: FubonTradingEvent) => void;
type Logger = Pick<Console, "info">;

export type FubonOfflineRecoveryStrategy = "relogin" | "restartGateway";

export interface FubonGateway {
  readonly isRunning: boolean;
  start(): Promise<void>;
  request<M extends FubonGatewayMethod>(
    method: M,
    payload: FubonGatewayCommandMap[M]["request"],
  ): Promise<FubonGatewayCommandMap[M]["response"]>;
  onEvent(listener: GatewayEventListener): () => void;
  onExit(listener: GatewayExitListener): () => void;
  close(): Promise<void>;
}

interface GatewayProcess {
  send(message: unknown): void;
  kill(): void;
}

interface GatewayProcessHandlers {
  onMessage(message: unknown): void;
  onExit(error: Error): void;
}

export type GatewayProcessFactory = (
  handlers: GatewayProcessHandlers,
) => GatewayProcess;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class FubonGatewayClient implements FubonGateway {
  #process: GatewayProcess | undefined;
  #processToken: symbol | undefined;
  #starting: Promise<void> | undefined;
  #startTimer: ReturnType<typeof setTimeout> | undefined;
  #resolveStart: (() => void) | undefined;
  #rejectStart: ((error: Error) => void) | undefined;
  #requestSequence = 0;
  #pendingRequests = new Map<string, PendingRequest>();
  #eventListeners = new Set<GatewayEventListener>();
  #exitListeners = new Set<GatewayExitListener>();

  constructor(
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    private readonly processFactory: GatewayProcessFactory = spawnFubonGatewayProcess,
  ) {}

  get isRunning(): boolean {
    return this.#process !== undefined && this.#starting === undefined;
  }

  start(): Promise<void> {
    if (this.#process && !this.#starting) {
      return Promise.resolve();
    }

    if (this.#starting) {
      return this.#starting;
    }

    const starting = new Promise<void>((resolve, reject) => {
      this.#resolveStart = resolve;
      this.#rejectStart = reject;
    });
    this.#starting = starting;
    const processToken = Symbol("fubon-gateway-process");
    this.#processToken = processToken;
    this.#startTimer = setTimeout(() => {
      const error = new Error("Fubon gateway startup timed out");
      const gatewayProcess = this.#process;
      this.handleExit(error);
      gatewayProcess?.kill();
    }, this.requestTimeoutMs);

    const gatewayProcess = this.processFactory({
      onMessage: (message) => {
        if (this.#processToken === processToken) {
          this.handleMessage(message);
        }
      },
      onExit: (error) => {
        if (this.#processToken === processToken) {
          this.handleExit(error);
        }
      },
    });

    if (this.#processToken === processToken) {
      this.#process = gatewayProcess;
    } else {
      gatewayProcess.kill();
    }

    return starting;
  }

  async request<M extends FubonGatewayMethod>(
    method: M,
    payload: FubonGatewayCommandMap[M]["request"],
  ): Promise<FubonGatewayCommandMap[M]["response"]> {
    await this.start();

    const gatewayProcess = this.#process;
    if (!gatewayProcess) {
      throw new Error("Fubon gateway is not running");
    }

    const id = String(++this.#requestSequence);
    const request: FubonGatewayRequest<M> = {
      type: "request",
      id,
      method,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(new Error(`Fubon gateway request timed out: ${method}`));
      }, this.requestTimeoutMs);

      this.#pendingRequests.set(id, {
        resolve: (value) =>
          resolve(value as FubonGatewayCommandMap[M]["response"]),
        reject,
        timer,
      });

      try {
        gatewayProcess.send(request);
      } catch (error) {
        clearTimeout(timer);
        this.#pendingRequests.delete(id);
        reject(
          error instanceof Error
            ? error
            : new Error("Failed to send request to Fubon gateway"),
        );
      }
    });
  }

  onEvent(listener: GatewayEventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  onExit(listener: GatewayExitListener): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  async close(): Promise<void> {
    const gatewayProcess = this.#process;
    if (!gatewayProcess) {
      return;
    }

    try {
      await this.request("logout", {});
    } finally {
      gatewayProcess.kill();
      this.#process = undefined;
      this.#processToken = undefined;
    }
  }

  private handleMessage(rawMessage: unknown): void {
    if (!isFubonGatewayMessage(rawMessage)) {
      return;
    }

    const message: FubonGatewayMessage = rawMessage;

    if (message.type === "ready") {
      if (this.#startTimer !== undefined) {
        clearTimeout(this.#startTimer);
        this.#startTimer = undefined;
      }
      this.#resolveStart?.();
      this.#starting = undefined;
      this.#resolveStart = undefined;
      this.#rejectStart = undefined;
      return;
    }

    if (message.type === "event") {
      for (const listener of this.#eventListeners) {
        listener(message);
      }
      return;
    }

    const pendingRequest = this.#pendingRequests.get(message.id);
    if (!pendingRequest) {
      return;
    }

    clearTimeout(pendingRequest.timer);
    this.#pendingRequests.delete(message.id);

    if (message.ok) {
      pendingRequest.resolve(message.data);
      return;
    }

    pendingRequest.reject(
      new Error(`${message.error.code}: ${message.error.message}`),
    );
  }

  private handleExit(error: Error): void {
    this.#process = undefined;
    this.#processToken = undefined;
    if (this.#startTimer !== undefined) {
      clearTimeout(this.#startTimer);
      this.#startTimer = undefined;
    }
    this.#rejectStart?.(error);
    this.#starting = undefined;
    this.#resolveStart = undefined;
    this.#rejectStart = undefined;

    for (const request of this.#pendingRequests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.#pendingRequests.clear();

    for (const listener of this.#exitListeners) {
      listener(error);
    }
  }
}

export class FubonConnector implements Connector {
  #status: ConnectorStatus = "attempting";
  #accounts: FubonAccount[] = [];
  #disconnectListeners = new Set<DisconnectListener>();
  #marketDataWebSocketListeners = new Set<MarketDataWebSocketListener>();
  #tradingEventListeners = new Set<TradingEventListener>();

  constructor(
    private readonly credentials: FubonCredentials,
    private readonly gateway: FubonGateway = new FubonGatewayClient(),
    private readonly logger: Logger = console,
    private readonly offlineRecoveryStrategy: FubonOfflineRecoveryStrategy = "relogin",
  ) {
    this.gateway.onExit(() => this.markDisconnected());
    this.gateway.onEvent((event) => {
      if (event.event === "marketDataHeartbeatTimeout") {
        this.logger.info("Fubon market data heartbeat timed out", {
          timeoutMs: event.data.timeoutMs,
          recoveryStrategy: this.offlineRecoveryStrategy,
        });
        void this.recoverFromOfflineGateway();
      }

      if (event.event === "marketDataWebSocket") {
        for (const listener of this.#marketDataWebSocketListeners) {
          listener(event.data);
        }
      }

      if (event.event === "trading") {
        for (const listener of this.#tradingEventListeners) {
          listener(event.data);
        }
      }
    });
  }

  get status(): ConnectorStatus {
    return this.#status;
  }

  get accounts(): readonly FubonAccount[] {
    return this.#accounts;
  }

  get simulation(): boolean {
    return this.credentials.testEnvironment === true;
  }

  async connect(): Promise<void> {
    if (this.#status === "connected") {
      return;
    }

    await this.gateway.start();
    await this.gateway.request("login", {
      credentials: this.credentials,
    });

    if (!this.gateway.isRunning) {
      throw new Error("Fubon gateway exited during login");
    }

    const accountResult = await this.gateway.request("getAccounts", {});
    this.#accounts = accountResult.accounts;
    this.#status = "connected";
    this.logger.info("Fubon accounts available", this.#accounts);
  }

  request<M extends Exclude<FubonGatewayMethod, "login" | "logout">>(
    method: M,
    payload: FubonGatewayCommandMap[M]["request"],
  ): Promise<FubonGatewayCommandMap[M]["response"]> {
    if (this.#status !== "connected") {
      return Promise.reject(new Error("Fubon connector is not connected"));
    }

    return this.gateway.request(method, payload);
  }

  invokeProxy(invocation: FubonProxyInvocation): Promise<unknown> {
    return this.request("invoke", invocation);
  }

  async openMarketDataWebSocket(
    id: string,
    mode: MarketDataWebSocketMode,
    product: "stock" | "futopt" = "stock",
  ): Promise<void> {
    await this.request("openMarketDataWebSocket", { id, mode, product });
  }

  async sendMarketDataWebSocket(id: string, message: string): Promise<void> {
    await this.request("sendMarketDataWebSocket", { id, message });
  }

  async closeMarketDataWebSocket(id: string): Promise<void> {
    await this.request("closeMarketDataWebSocket", { id });
  }

  onMarketDataWebSocketMessage(
    listener: MarketDataWebSocketListener,
  ): () => void {
    this.#marketDataWebSocketListeners.add(listener);
    return () => this.#marketDataWebSocketListeners.delete(listener);
  }

  onTradingEvent(listener: TradingEventListener): () => void {
    this.#tradingEventListeners.add(listener);
    return () => this.#tradingEventListeners.delete(listener);
  }

  onDisconnect(listener: DisconnectListener): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.gateway.close();
    this.markDisconnected();
  }

  private markDisconnected(): void {
    if (this.#status === "attempting") {
      return;
    }

    this.#status = "attempting";
    this.#accounts = [];

    for (const listener of this.#disconnectListeners) {
      listener();
    }
  }

  private async recoverFromOfflineGateway(): Promise<void> {
    if (this.#status === "attempting") {
      return;
    }

    if (this.offlineRecoveryStrategy === "restartGateway") {
      try {
        await this.gateway.close();
      } finally {
        this.markDisconnected();
      }
      return;
    }

    this.markDisconnected();
  }
}

function spawnFubonGatewayProcess(
  handlers: GatewayProcessHandlers,
): GatewayProcess {
  const gatewayScriptPath = new URL(
    "./fubon-gateway.process.ts",
    import.meta.url,
  ).pathname;
  const subprocess = Bun.spawn({
    cmd: [process.execPath, "run", gatewayScriptPath],
    stdout: "inherit",
    stderr: "inherit",
    ipc: (message: unknown) => handlers.onMessage(message),
    onExit: (_subprocess, exitCode, signalCode, error) => {
      handlers.onExit(
        new Error(
          error?.message ??
            `Fubon gateway exited (exit: ${exitCode}, signal: ${signalCode})`,
        ),
      );
    },
  });

  return {
    send: (message) => subprocess.send(message),
    kill: () => subprocess.kill(),
  };
}
