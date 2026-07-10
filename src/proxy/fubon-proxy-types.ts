export type FubonProxyService =
  | "stock"
  | "accounting"
  | "futopt"
  | "futoptAccounting"
  | "marketDataStock"
  | "marketDataFutopt";

export interface FubonProxyTarget {
  service: FubonProxyService;
  methodPath: string[];
}

export interface FubonProxyInvocation {
  target: FubonProxyTarget;
  arguments: unknown[];
}

export type MarketDataWebSocketMode = "speed" | "normal";

export interface MarketDataWebSocketMessage {
  id: string;
  message: string;
}

export interface FubonProxyInvoker {
  readonly status: "attempting" | "connected";
  invokeProxy(invocation: FubonProxyInvocation): Promise<unknown>;
}
