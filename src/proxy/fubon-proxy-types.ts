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

export interface FubonProxyInvoker {
  readonly status: "attempting" | "connected";
  invokeProxy(invocation: FubonProxyInvocation): Promise<unknown>;
}
