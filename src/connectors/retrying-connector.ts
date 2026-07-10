import type { Connector } from "./connector.ts";

const DEFAULT_RETRY_INTERVAL_MS = 60_000;

type Timer = ReturnType<typeof setTimeout>;
type ScheduleRetry = (callback: () => void, delay: number) => Timer;
type Logger = Pick<Console, "info" | "error">;

export class RetryingConnector {
  #started = false;
  #retryTimer: Timer | undefined;
  #unsubscribeFromDisconnect: (() => void) | undefined;

  constructor(
    private readonly connector: Connector,
    private readonly retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS,
    private readonly logger: Logger = console,
    private readonly scheduleRetry: ScheduleRetry = setTimeout,
  ) {}

  start(): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#unsubscribeFromDisconnect = this.connector.onDisconnect(() => {
      this.scheduleConnectionAttempt();
    });
    void this.attemptConnection();
  }

  stop(): void {
    this.#started = false;
    this.#unsubscribeFromDisconnect?.();
    this.#unsubscribeFromDisconnect = undefined;

    if (this.#retryTimer !== undefined) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
  }

  private async attemptConnection(): Promise<void> {
    try {
      await this.connector.connect();
      this.logger.info("Fubon connection established");
    } catch (error) {
      this.logger.error(
        `Fubon connection attempt failed; retrying in ${this.retryIntervalMs / 1000} seconds`,
        error,
      );

      this.scheduleConnectionAttempt();
    }
  }

  private scheduleConnectionAttempt(): void {
    if (!this.#started || this.#retryTimer !== undefined) {
      return;
    }

    this.#retryTimer = this.scheduleRetry(() => {
      this.#retryTimer = undefined;
      void this.attemptConnection();
    }, this.retryIntervalMs);
  }
}
