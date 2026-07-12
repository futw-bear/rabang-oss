import {
  arrayField,
  assertAllowedFields,
  BridgeHttpError,
  readJsonObject,
  record,
  stringField,
} from "./common.ts";

interface BridgeContract {
  security_type: string;
  exchange: string;
  code: string;
  target_code?: string | null;
}

interface Watchlist {
  id: string;
  person_id: string;
  name: string;
  contracts: BridgeContract[];
}

export class LocalBridgeApi {
  readonly #watchlists = new Map<string, Watchlist>();
  readonly #apps = new Map<string, Map<string, Blob>>();

  async watchlist(path: string, request: Request): Promise<Response> {
    if (path === "/api/v1/watchlist") {
      if (request.method === "GET")
        return Response.json([...this.#watchlists.values()]);
      const body = await readJsonObject(request);
      assertAllowedFields(body, ["name", "contracts"]);
      const value: Watchlist = {
        id: crypto.randomUUID(),
        person_id: "",
        name: stringField(body, "name", true)!,
        contracts:
          body.contracts === undefined
            ? []
            : parseContracts(arrayField(body, "contracts")),
      };
      this.#watchlists.set(value.id, value);
      return Response.json(value);
    }

    const match = path.match(/^\/api\/v1\/watchlist\/([^/]+)(\/contracts)?$/);
    if (!match) throw new BridgeHttpError(404, "Watchlist endpoint not found");
    const id = decodeURIComponent(match[1] ?? "");
    const value = this.#watchlists.get(id);
    if (!value) throw new BridgeHttpError(404, `Watchlist not found: ${id}`);

    if (!match[2]) {
      if (request.method === "GET") return Response.json(value);
      if (request.method === "DELETE") {
        this.#watchlists.delete(id);
        return Response.json(value);
      }
      const body = await readJsonObject(request);
      assertAllowedFields(body, ["contracts"]);
      value.contracts = parseContracts(arrayField(body, "contracts"));
      return Response.json(value);
    }

    const body = await readJsonObject(request);
    assertAllowedFields(body, ["contracts"]);
    const contracts = parseContracts(arrayField(body, "contracts"));
    if (request.method === "POST") {
      for (const contract of contracts) {
        if (
          !value.contracts.some(
            (existing) => contractKey(existing) === contractKey(contract),
          )
        ) {
          value.contracts.push(contract);
        }
      }
    } else {
      const removed = new Set(contracts.map(contractKey));
      value.contracts = value.contracts.filter(
        (contract) => !removed.has(contractKey(contract)),
      );
    }
    return Response.json(value);
  }

  async apps(path: string, request: Request): Promise<Response> {
    if (path === "/api/v1/apps") {
      return Response.json({ apps: [...this.#apps.keys()].sort() });
    }
    const match = path.match(/^\/api\/v1\/apps\/([^/]+)$/);
    if (!match) throw new BridgeHttpError(404, "App endpoint not found");
    const name = safeSegment(decodeURIComponent(match[1] ?? ""));
    if (request.method === "DELETE") {
      if (!this.#apps.delete(name))
        throw new BridgeHttpError(404, `App not found: ${name}`);
      return Response.json({ deleted: name });
    }

    const contentLength = Number(request.headers.get("Content-Length"));
    if (!Number.isFinite(contentLength)) {
      throw new BridgeHttpError(400, "Content-Length is required");
    }
    if (contentLength > 50 * 1024 * 1024) {
      throw new BridgeHttpError(413, "App upload exceeds 50 MB");
    }
    const form = await request.formData();
    const files = form.getAll("files");
    if (files.length === 0 || files.some((file) => typeof file === "string")) {
      throw new BridgeHttpError(
        400,
        "Multipart field files must contain uploaded files",
      );
    }
    const stored = new Map<string, Blob>();
    for (const item of files) {
      const file = item as File;
      const filename = safeSegment(file.name.split(/[\\/]/).at(-1) ?? "");
      stored.set(filename, file);
    }
    this.#apps.set(name, stored);
    return Response.json({
      name,
      files: [...stored.keys()].map((filename) => `${name}/${filename}`),
    });
  }

  serveApp(path: string): Response {
    const relative = path.slice("/apps/".length);
    const slash = relative.indexOf("/");
    if (slash <= 0) throw new BridgeHttpError(404, "App file not found");
    const name = safeSegment(decodeURIComponent(relative.slice(0, slash)));
    const filename = safeSegment(decodeURIComponent(relative.slice(slash + 1)));
    const file = this.#apps.get(name)?.get(filename);
    if (!file) throw new BridgeHttpError(404, "App file not found");
    return new Response(file, {
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
  }
}

function parseContracts(values: unknown[]): BridgeContract[] {
  return values.map((value) => {
    const item = record(value);
    assertAllowedFields(item, [
      "security_type",
      "exchange",
      "code",
      "target_code",
    ]);
    return {
      security_type: stringField(item, "security_type", true)!,
      exchange: stringField(item, "exchange", true)!,
      code: stringField(item, "code", true)!,
      target_code:
        item.target_code === null ? null : stringField(item, "target_code"),
    };
  });
}

function contractKey(contract: BridgeContract): string {
  return `${contract.security_type}:${contract.exchange}:${contract.code}:${contract.target_code ?? ""}`;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new BridgeHttpError(400, "Unsafe app path");
  }
  return value;
}
