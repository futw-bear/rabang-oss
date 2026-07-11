import { describe, expect, test } from "bun:test";
import {
  isMarketDataHeartbeat,
  MarketDataHeartbeatWatchdog,
} from "../../src/connectors/market-data-heartbeat.ts";

describe("isMarketDataHeartbeat", () => {
  test("accepts only market data heartbeat messages", () => {
    expect(
      isMarketDataHeartbeat(
        JSON.stringify({ event: "heartbeat", data: { time: 123 } }),
      ),
    ).toBe(true);
    expect(isMarketDataHeartbeat(JSON.stringify({ event: "pong" }))).toBe(
      false,
    );
    expect(isMarketDataHeartbeat("invalid JSON")).toBe(false);
    expect(isMarketDataHeartbeat({ event: "heartbeat" })).toBe(false);
  });
});

describe("MarketDataHeartbeatWatchdog", () => {
  test("times out after 60 seconds without a heartbeat", () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    let timeouts = 0;
    const watchdog = new MarketDataHeartbeatWatchdog(
      () => {
        timeouts += 1;
      },
      60_000,
      (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      () => {},
    );

    watchdog.start();

    expect(scheduled.map(({ delay }) => delay)).toEqual([60_000]);
    scheduled[0]?.callback();
    expect(timeouts).toBe(1);
  });

  test("resets the timeout whenever a heartbeat arrives", () => {
    const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
    const watchdog = new MarketDataHeartbeatWatchdog(
      () => {},
      60_000,
      (callback) => {
        scheduled.push({ callback, cancelled: false });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      (timer) => {
        const index = Number(timer) - 1;
        const scheduledTimeout = scheduled[index];
        if (scheduledTimeout) {
          scheduledTimeout.cancelled = true;
        }
      },
    );

    watchdog.start();
    watchdog.heartbeat();

    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]?.cancelled).toBe(true);
    expect(scheduled[1]?.cancelled).toBe(false);
  });
});
