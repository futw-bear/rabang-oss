export type ConnectorStatus = "attempting" | "connected";

export interface Connector {
  readonly status: ConnectorStatus;
  connect(): Promise<void>;
  onDisconnect(listener: () => void): () => void;
}
