import type { Connector } from "../connectors/connector.ts";
import type {
  MarketDataWebSocketMessage,
  MarketDataWebSocketMode,
} from "../proxy/fubon-proxy-types.ts";

export interface MarketDataWebSocketConnector extends Connector {
  openMarketDataWebSocket(
    id: string,
    mode: MarketDataWebSocketMode,
  ): Promise<void>;
  sendMarketDataWebSocket(id: string, message: string): Promise<void>;
  closeMarketDataWebSocket(id: string): Promise<void>;
  onMarketDataWebSocketMessage(
    listener: (message: MarketDataWebSocketMessage) => void,
  ): () => void;
}

export interface ProxyWebSocket {
  readonly data: { id: string; mode: MarketDataWebSocketMode };
  send(message: string): unknown;
  close(code?: number, reason?: string): unknown;
}

export function parseMarketDataWebSocketMode(
  mode: string | null,
): MarketDataWebSocketMode | undefined {
  if (mode === null || mode === "speed") {
    return "speed";
  }

  return mode === "normal" ? "normal" : undefined;
}

export class MarketDataWebSocketProxy {
  #sockets = new Map<string, ProxyWebSocket>();
  #opening = new Map<string, Promise<void>>();

  constructor(private readonly connector: MarketDataWebSocketConnector) {
    this.connector.onMarketDataWebSocketMessage((message) => {
      this.#sockets.get(message.id)?.send(message.message);
    });
  }

  open(socket: ProxyWebSocket): void {
    const { id, mode } = socket.data;
    this.#sockets.set(id, socket);
    const opening = this.connector.openMarketDataWebSocket(id, mode);
    this.#opening.set(id, opening);

    void opening.then(
      () => undefined,
      (error) => {
        socket.send(
          JSON.stringify({
            event: "error",
            data: {
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to open market data WebSocket",
            },
          }),
        );
        socket.close(1011, "Unable to open market data WebSocket");
      },
    );
  }

  async message(socket: ProxyWebSocket, message: string | Uint8Array): Promise<void> {
    const id = socket.data.id;
    const opening = this.#opening.get(id);
    if (!opening) {
      return;
    }

    try {
      await opening;
      await this.connector.sendMarketDataWebSocket(
        id,
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message),
      );
    } catch (error) {
      socket.send(
        JSON.stringify({
          event: "error",
          data: {
            message:
              error instanceof Error
                ? error.message
                : "Unable to process market data WebSocket message",
          },
        }),
      );
    }
  }

  close(socket: ProxyWebSocket): void {
    const { id } = socket.data;
    this.#sockets.delete(id);
    this.#opening.delete(id);
    void this.connector.closeMarketDataWebSocket(id);
  }
}
