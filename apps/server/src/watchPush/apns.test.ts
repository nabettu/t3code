// @effect-diagnostics nodeBuiltinImport:off -- Generates a real P-256 key to verify the APNs token signature.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { makeApnsJwt, readWatchPushDevices, writeWatchPushDevices } from "./apns.ts";

describe("makeApnsJwt", () => {
  it("signs an ES256 token APNs can verify with the key's public half", () => {
    const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwt = makeApnsJwt(
      {
        teamId: "TEAM123456",
        keyId: "KEY1234567",
        bundleId: "com.example.app",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
      1_700_000_000,
    );
    const [header = "", claims = "", signature = ""] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "TEAM123456",
      iat: 1_700_000_000,
    });
    expect(
      NodeCrypto.verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("watch push device list", () => {
  it("reads a missing list as empty and refuses a corrupt one instead of overwriting it", async () => {
    await using directory = {
      path: NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-watch-push-")),
      async [Symbol.asyncDispose]() {
        NodeFS.rmSync(this.path, { recursive: true, force: true });
      },
    };
    const file = NodePath.join(directory.path, "devices.json");
    expect(await readWatchPushDevices(file)).toEqual([]);

    const device = {
      token: "ab".repeat(32),
      apsEnvironment: "sandbox" as const,
      actionBaseUrl: "https://mac.example.test",
      sessionId: "session-1",
      updatedAt: "2026-11-21T00:00:00.000Z",
    };
    await writeWatchPushDevices(file, [device], "a");
    expect(await readWatchPushDevices(file)).toEqual([device]);

    NodeFS.writeFileSync(file, "{not json");
    await expect(readWatchPushDevices(file)).rejects.toThrow();
  });
});
