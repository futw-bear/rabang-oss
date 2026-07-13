import { describe, expect, test } from "bun:test";
import {
  loadDatabasePath,
  loadFubonCredentials,
  loadFubonOfflineRecoveryStrategy,
  loadPort,
} from "../src/config.ts";

describe("loadFubonCredentials", () => {
  test("loads password credentials and defaults the certificate password", () => {
    expect(
      loadFubonCredentials({
        FUBON_PERSONAL_ID: "personal-id",
        FUBON_PASSWORD: "password",
        FUBON_CERT_PATH: "/cert.pfx",
      }),
    ).toEqual({
      method: "password",
      personalId: "personal-id",
      password: "password",
      certPath: "/cert.pfx",
      certPassword: "personal-id",
      testEnvironment: false,
    });
  });

  test("loads API key credentials with an explicit certificate password", () => {
    expect(
      loadFubonCredentials({
        FUBON_PERSONAL_ID: "personal-id",
        FUBON_API_KEY: "api-key",
        FUBON_CERT_PATH: "/cert.pfx",
        FUBON_CERT_PASSWORD: "cert-password",
      }),
    ).toEqual({
      method: "apiKey",
      personalId: "personal-id",
      apiKey: "api-key",
      certPath: "/cert.pfx",
      certPassword: "cert-password",
      testEnvironment: false,
    });
  });

  test("rejects ambiguous authentication credentials", () => {
    expect(() =>
      loadFubonCredentials({
        FUBON_PERSONAL_ID: "personal-id",
        FUBON_PASSWORD: "password",
        FUBON_API_KEY: "api-key",
        FUBON_CERT_PATH: "/cert.pfx",
      }),
    ).toThrow("Set either FUBON_PASSWORD or FUBON_API_KEY, but not both");
  });

  test("enables the test environment only when FUBON_TESTENV is 1", () => {
    const baseEnvironment = {
      FUBON_PERSONAL_ID: "personal-id",
      FUBON_PASSWORD: "password",
      FUBON_CERT_PATH: "/cert.pfx",
    };

    expect(
      loadFubonCredentials({ ...baseEnvironment, FUBON_TESTENV: "1" })
        .testEnvironment,
    ).toBe(true);
    expect(
      loadFubonCredentials({ ...baseEnvironment, FUBON_TESTENV: "true" })
        .testEnvironment,
    ).toBe(false);
  });

  test("uses the bundled test credentials when no login values are supplied", () => {
    const credentials = loadFubonCredentials({ FUBON_TESTENV: "1" });

    expect(credentials.method).toBe("password");

    if (credentials.method !== "password") {
      throw new Error("Expected password credentials");
    }

    expect(credentials.testEnvironment).toBe(true);
    expect(credentials.personalId).toBeTruthy();
    expect(credentials.password).toBeTruthy();
    expect(credentials.certPath).toEndWith(".pfx");
    expect(credentials.certPassword).toBeTruthy();
  });

  test("ignores all externally supplied Fubon credentials in the test environment", () => {
    const bundledCredentials = loadFubonCredentials({ FUBON_TESTENV: "1" });
    const suppliedCredentials = loadFubonCredentials({
      FUBON_TESTENV: "1",
      FUBON_PERSONAL_ID: "override-id",
      FUBON_API_KEY: "override-api-key",
      FUBON_PASSWORD: "override-password",
      FUBON_CERT_PATH: "/override.pfx",
      FUBON_CERT_PASSWORD: "override-cert-password",
    });

    expect(suppliedCredentials).toEqual(bundledCredentials);
  });
});

describe("loadPort", () => {
  test("uses port 3000 by default", () => {
    expect(loadPort({})).toBe(3000);
  });

  test("rejects invalid ports", () => {
    expect(() => loadPort({ PORT: "invalid" })).toThrow("Invalid PORT");
  });
});

describe("loadDatabasePath", () => {
  test("uses a persistent local database by default", () => {
    expect(loadDatabasePath({})).toBe("./rabang.sqlite");
  });

  test("accepts an override and rejects an empty path", () => {
    expect(
      loadDatabasePath({ RABANG_DATABASE_PATH: "/data/orders.sqlite" }),
    ).toBe("/data/orders.sqlite");
    expect(() => loadDatabasePath({ RABANG_DATABASE_PATH: "  " })).toThrow(
      "RABANG_DATABASE_PATH must not be empty",
    );
  });
});

describe("loadFubonOfflineRecoveryStrategy", () => {
  test("defaults to retrying a login in the existing gateway", () => {
    expect(loadFubonOfflineRecoveryStrategy({})).toBe("relogin");
    expect(
      loadFubonOfflineRecoveryStrategy({ SERVER_GATEWAY_RECOVERY: "relogin" }),
    ).toBe("relogin");
  });

  test("supports restarting the gateway process", () => {
    expect(
      loadFubonOfflineRecoveryStrategy({
        SERVER_GATEWAY_RECOVERY: "restart-gateway",
      }),
    ).toBe("restartGateway");
  });

  test("rejects unsupported strategies", () => {
    expect(() =>
      loadFubonOfflineRecoveryStrategy({
        SERVER_GATEWAY_RECOVERY: "unsupported",
      }),
    ).toThrow("Invalid SERVER_GATEWAY_RECOVERY");
  });
});
