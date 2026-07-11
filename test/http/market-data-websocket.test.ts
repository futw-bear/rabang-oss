import { describe, expect, test } from "bun:test";
import type { ConnectorStatus } from "../../src/connectors/connector.ts";
import {
  MarketDataWebSocketProxy,
  parseMarketDataWebSocketMode,
  type MarketDataWebSocketConnector,
  type ProxyWebSocket,
} from "../../src/http/market-data-websocket.ts";
import type {
  FubonProxyInvocation,
  MarketDataWebSocketMessage,
  MarketDataWebSocketMode,
} from "../../src/proxy/fubon-proxy-types.ts";

describe("parseMarketDataWebSocketMode", () => {
  test("defaults to speed and accepts the documented modes", () => {
    expect(parseMarketDataWebSocketMode(null)).toBe("speed");
    expect(parseMarketDataWebSocketMode("speed")).toBe("speed");
    expect(parseMarketDataWebSocketMode("normal")).toBe("normal");
    expect(parseMarketDataWebSocketMode("invalid")).toBeUndefined();
  });
});

describe("MarketDataWebSocketProxy", () => {
  test("opens in the selected mode and forwards SDK commands unchanged", async () => {
    const connector = new FakeMarketDataWebSocketConnector();
    const proxy = new MarketDataWebSocketProxy(connector);
    const socket = new FakeWebSocket("connection-1", "normal");

    proxy.open(socket);
    await proxy.message(
      socket,
      JSON.stringify({
        event: "subscribe",
        data: { channel: "trades", symbol: "2330" },
      }),
    );

    expect(connector.opened).toEqual([
      { id: "connection-1", mode: "normal" },
    ]);
    expect(connector.sent).toEqual([
      {
        id: "connection-1",
        message: JSON.stringify({
          event: "subscribe",
          data: { channel: "trades", symbol: "2330" },
        }),
      },
    ]);
  });

  test("forwards upstream events unchanged to the matching client", () => {
    const connector = new FakeMarketDataWebSocketConnector();
    const proxy = new MarketDataWebSocketProxy(connector);
    const socket = new FakeWebSocket("connection-1", "speed");
    proxy.open(socket);

    connector.emit({
      id: "connection-1",
      message: '{"event":"subscribed","data":{"id":"channel-id"}}',
    });

    expect(socket.sent).toEqual([
      '{"event":"subscribed","data":{"id":"channel-id"}}',
    ]);
  });

  test("disconnects the gateway session when the client closes", async () => {
    const connector = new FakeMarketDataWebSocketConnector();
    const proxy = new MarketDataWebSocketProxy(connector);
    const socket = new FakeWebSocket("connection-1", "speed");
    proxy.open(socket);

    proxy.close(socket);
    await Bun.sleep(0);

    expect(connector.closed).toEqual(["connection-1"]);
  });
});

class FakeMarketDataWebSocketConnector
  implements MarketDataWebSocketConnector
{
  status: ConnectorStatus = "connected";
  opened: Array<{ id: string; mode: MarketDataWebSocketMode }> = [];
  sent: Array<{ id: string; message: string }> = [];
  closed: string[] = [];
  #listeners = new Set<(message: MarketDataWebSocketMessage) => void>();

  async connect(): Promise<void> {}

  async invokeProxy(_invocation: FubonProxyInvocation): Promise<unknown> {
    return undefined;
  }

  onDisconnect(): () => void {
    return () => {};
  }

  async openMarketDataWebSocket(
    id: string,
    mode: MarketDataWebSocketMode,
  ): Promise<void> {
    this.opened.push({ id, mode });
  }

  async sendMarketDataWebSocket(id: string, message: string): Promise<void> {
    this.sent.push({ id, message });
  }

  async closeMarketDataWebSocket(id: string): Promise<void> {
    this.closed.push(id);
  }

  onMarketDataWebSocketMessage(
    listener: (message: MarketDataWebSocketMessage) => void,
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(message: MarketDataWebSocketMessage): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}

class FakeWebSocket implements ProxyWebSocket {
  sent: string[] = [];

  constructor(readonly id: string, readonly mode: MarketDataWebSocketMode) {}

  get data(): { id: string; mode: MarketDataWebSocketMode } {
    return { id: this.id, mode: this.mode };
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {}
}
