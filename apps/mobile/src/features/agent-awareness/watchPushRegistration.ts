import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { connectionAtomRuntime } from "../../connection/runtime";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  environmentConnectedAtom,
  savedConnectionsByIdAtom,
} from "../../state/use-remote-environment-registry";
import { resolveApsEnvironment } from "./registrationPayload";

const registerDevice = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "watch-push:register-device",
  tag: WS_METHODS.watchPushRegisterDevice,
});

const connectedTargetsAtom = Atom.make((get) =>
  Object.values(get(savedConnectionsByIdAtom)).flatMap((connection) =>
    get(environmentConnectedAtom(connection.environmentId))
      ? [{ environmentId: connection.environmentId, httpBaseUrl: connection.httpBaseUrl }]
      : [],
  ),
).pipe(Atom.withLabel("mobile:watch-push:connected-targets"));

async function readDeviceToken(): Promise<string | null> {
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === "string" ? token.data : null;
}

/**
 * Hands each connected server this phone's APNs token and the address it reaches that server at,
 * so the server can push approval and next-action alerts whose buttons post straight back to it.
 * Servers without the method refuse once per launch, which is fine.
 */
export function installWatchPushRegistration(): () => void {
  if (Platform.OS !== "ios") return () => {};
  const apsEnvironment = resolveApsEnvironment(Constants.expoConfig?.extra?.appVariant);
  const sent = new Set<string>();
  let token: Promise<string | null> | null = null;

  const register = async (
    targets: ReadonlyArray<{ environmentId: EnvironmentId; httpBaseUrl: string }>,
  ) => {
    if (targets.length === 0) return;
    token ??= readDeviceToken().catch(() => null);
    const deviceToken = await token;
    if (deviceToken === null) {
      token = null;
      return;
    }
    for (const target of targets) {
      const key = `${target.environmentId}|${deviceToken}|${target.httpBaseUrl}`;
      if (sent.has(key) || !/^https?:\/\//.test(target.httpBaseUrl)) continue;
      sent.add(key);
      void registerDevice.run(appAtomRegistry, {
        environmentId: target.environmentId,
        input: { token: deviceToken, apsEnvironment, actionBaseUrl: target.httpBaseUrl },
      });
    }
  };

  return appAtomRegistry.subscribe(connectedTargetsAtom, (targets) => void register(targets), {
    immediate: true,
  });
}
