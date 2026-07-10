export type ConnectorStatus = "attempting" | "connected";

export interface Connector {
  readonly status: ConnectorStatus;
  connect(): Promise<void>;
  invokeProxy(invocation: FubonProxyInvocation): Promise<unknown>;
  onDisconnect(listener: () => void): () => void;
}
import type { FubonProxyInvocation } from "../proxy/fubon-proxy-types.ts";
