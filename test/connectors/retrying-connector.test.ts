import { describe, expect, test } from "bun:test";
import type {
  Connector,
  ConnectorStatus,
} from "../../src/connectors/connector.ts";
import { RetryingConnector } from "../../src/connectors/retrying-connector.ts";
import type { FubonProxyInvocation } from "../../src/proxy/fubon-proxy-types.ts";

describe("RetryingConnector", () => {
  test("retries after 60 seconds until the connector succeeds", async () => {
    const connector = new FlakyConnector();
    const scheduledRetries: Array<() => void> = [];
    const scheduledDelays: number[] = [];
    const retryingConnector = new RetryingConnector(
      connector,
      60_000,
      { info: () => {}, error: () => {} },
      (callback, delay) => {
        scheduledRetries.push(callback);
        scheduledDelays.push(delay);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    );

    retryingConnector.start();
    await Bun.sleep(0);

    expect(connector.attempts).toBe(1);
    expect(connector.status).toBe("attempting");
    expect(scheduledDelays).toEqual([60_000]);

    scheduledRetries[0]?.();
    await Bun.sleep(0);

    expect(connector.attempts).toBe(2);
    expect(connector.status).toBe("connected");
    expect(scheduledRetries).toHaveLength(1);

    retryingConnector.stop();
  });

  test("schedules a reconnect when a connected gateway disconnects", async () => {
    const connector = new FlakyConnector(false);
    const scheduledRetries: Array<() => void> = [];
    const retryingConnector = new RetryingConnector(
      connector,
      60_000,
      { info: () => {}, error: () => {} },
      (callback) => {
        scheduledRetries.push(callback);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    );

    retryingConnector.start();
    await Bun.sleep(0);
    expect(connector.status).toBe("connected");

    connector.emitDisconnect();

    expect(scheduledRetries).toHaveLength(1);
    retryingConnector.stop();
  });
});

class FlakyConnector implements Connector {
  status: ConnectorStatus = "attempting";
  attempts = 0;
  #disconnectListeners = new Set<() => void>();

  constructor(private readonly failFirstAttempt = true) {}

  async connect(): Promise<void> {
    this.attempts += 1;

    if (this.failFirstAttempt && this.attempts === 1) {
      throw new Error("Login failed");
    }

    this.status = "connected";
  }

  async invokeProxy(_invocation: FubonProxyInvocation): Promise<unknown> {
    return undefined;
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  emitDisconnect(): void {
    this.status = "attempting";
    for (const listener of this.#disconnectListeners) {
      listener();
    }
  }
}
