// @effect-diagnostics nodeBuiltinImport:off -- APNs needs HTTP/2 (node:http2) and the key and device files live outside any Effect-managed state.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp2 from "node:http2";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { WatchPushRegisterDeviceInput } from "@t3tools/contracts";

/** Holds config.json (teamId, keyId, bundleId, keyPath) and the devices.json this server writes. */
export function watchPushDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3CODE_WATCH_PUSH_DIR ?? NodePath.join(NodeOS.homedir(), ".config", "t3-watch-push");
}

export interface WatchPushApnsConfig {
  readonly teamId: string;
  readonly keyId: string;
  readonly bundleId: string;
  readonly privateKey: string;
}

export interface WatchPushDevice extends WatchPushRegisterDeviceInput {
  readonly updatedAt: string;
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Null while the feature is not set up on this machine. */
export async function readWatchPushConfig(directory: string): Promise<WatchPushApnsConfig | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await NodeFSP.readFile(NodePath.join(directory, "config.json"), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { teamId, keyId, bundleId, keyPath } = raw as Record<string, unknown>;
  if (!isText(teamId) || !isText(keyId) || !isText(bundleId) || !isText(keyPath)) return null;
  const resolvedKeyPath = NodePath.resolve(
    directory,
    keyPath.replace(/^~(?=\/)/, NodeOS.homedir()),
  );
  return {
    teamId,
    keyId,
    bundleId,
    privateKey: await NodeFSP.readFile(resolvedKeyPath, "utf8"),
  };
}

export async function readWatchPushDevices(directory: string): Promise<Array<WatchPushDevice>> {
  try {
    const parsed: unknown = JSON.parse(
      await NodeFSP.readFile(NodePath.join(directory, "devices.json"), "utf8"),
    );
    return Array.isArray(parsed)
      ? parsed.filter(
          (device): device is WatchPushDevice =>
            typeof device === "object" &&
            device !== null &&
            isText(device.token) &&
            (device.apsEnvironment === "sandbox" || device.apsEnvironment === "production") &&
            isText(device.actionBaseUrl),
        )
      : [];
  } catch {
    return [];
  }
}

export async function writeWatchPushDevices(
  directory: string,
  devices: ReadonlyArray<WatchPushDevice>,
): Promise<void> {
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = NodePath.join(directory, "devices.json");
  const temporary = `${file}.${process.pid}.tmp`;
  await NodeFSP.writeFile(temporary, `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 });
  await NodeFSP.rename(temporary, file);
}

const base64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** APNs provider token: ES256 over `{alg,kid}.{iss,iat}`, valid for an hour. */
export function makeApnsJwt(config: WatchPushApnsConfig, issuedAtSeconds: number): string {
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = base64Url(JSON.stringify({ iss: config.teamId, iat: issuedAtSeconds }));
  const signature = NodeCrypto.sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${base64Url(signature)}`;
}

export interface ApnsResult {
  readonly status: number;
  readonly reason: string | null;
}

/** APNs only speaks HTTP/2, which fetch here does not. */
export function sendApnsAlert(input: {
  readonly config: WatchPushApnsConfig;
  readonly jwt: string;
  readonly device: Pick<WatchPushDevice, "token" | "apsEnvironment">;
  readonly payload: unknown;
  readonly collapseId?: string;
}): Promise<ApnsResult> {
  const host =
    input.device.apsEnvironment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  return new Promise((resolve, reject) => {
    const session = NodeHttp2.connect(host);
    session.on("error", reject);
    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${input.device.token}`,
      authorization: `bearer ${input.jwt}`,
      "apns-topic": input.config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      ...(input.collapseId === undefined ? {} : { "apns-collapse-id": input.collapseId }),
      "content-type": "application/json",
    });
    request.setTimeout(15_000, () => request.close(NodeHttp2.constants.NGHTTP2_CANCEL));
    let status = 0;
    let body = "";
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("error", (error) => {
      session.close();
      reject(error);
    });
    request.on("end", () => {
      session.close();
      let reason: string | null = null;
      try {
        const parsed: unknown = body === "" ? null : JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "reason" in parsed) {
          reason = String(parsed.reason);
        }
      } catch {
        reason = body.slice(0, 200);
      }
      resolve({ status, reason });
    });
    request.end(JSON.stringify(input.payload));
  });
}

/** The token is gone for good; drop the device instead of retrying it. */
export const isDeadApnsToken = (result: ApnsResult) =>
  result.status === 410 || result.reason === "Unregistered";
