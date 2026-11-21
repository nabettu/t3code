// @effect-diagnostics nodeBuiltinImport:off -- Generates a real P-256 key to verify the APNs token signature.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { makeApnsJwt } from "./apns.ts";

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
