import { describe, expect, test } from "bun:test";
import { loadFubonCredentials, loadPort } from "../src/config.ts";

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
});

describe("loadPort", () => {
  test("uses port 3000 by default", () => {
    expect(loadPort({})).toBe(3000);
  });

  test("rejects invalid ports", () => {
    expect(() => loadPort({ PORT: "invalid" })).toThrow("Invalid PORT");
  });
});
