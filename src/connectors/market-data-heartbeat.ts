export const MARKET_DATA_HEARTBEAT_TIMEOUT_MS = 60_000;

type Timer = ReturnType<typeof setTimeout>;
type ScheduleTimeout = (callback: () => void, delay: number) => Timer;
type CancelTimeout = (timer: Timer) => void;

export function isMarketDataHeartbeat(message: unknown): boolean {
  if (typeof message !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(message) as { event?: unknown };
    return parsed.event === "heartbeat";
  } catch {
    return false;
  }
}

export class MarketDataHeartbeatWatchdog {
  #timer: Timer | undefined;

  constructor(
    private readonly onTimeout: () => void,
    private readonly timeoutMs = MARKET_DATA_HEARTBEAT_TIMEOUT_MS,
    private readonly scheduleTimeout: ScheduleTimeout = setTimeout,
    private readonly cancelTimeout: CancelTimeout = clearTimeout,
  ) {}

  start(): void {
    this.reset();
  }

  heartbeat(): void {
    this.reset();
  }

  stop(): void {
    if (this.#timer === undefined) {
      return;
    }

    this.cancelTimeout(this.#timer);
    this.#timer = undefined;
  }

  private reset(): void {
    this.stop();
    this.#timer = this.scheduleTimeout(() => {
      this.#timer = undefined;
      this.onTimeout();
    }, this.timeoutMs);
  }
}
