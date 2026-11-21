import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

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

interface Target {
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
}

const connectedTargetsAtom = Atom.make((get) =>
  Object.values(get(savedConnectionsByIdAtom)).flatMap((connection): Array<Target> =>
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
 * Re-sends when the token, the address or the permission changes, and after a failed attempt.
 */
export function installWatchPushRegistration(): () => void {
  if (Platform.OS !== "ios") return () => {};
  const apsEnvironment = resolveApsEnvironment(Constants.expoConfig?.extra?.appVariant);
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  // What each server last accepted (or is being sent), so an A→B→A route change re-sends A.
  const registered = new Map<EnvironmentId, string>();
  let token: Promise<string | null> | null = null;

  const register = async () => {
    const targets = appAtomRegistry.get(connectedTargetsAtom);
    // A reconnect may bring a new session, so a server that dropped off is registered afresh.
    for (const environmentId of registered.keys()) {
      if (!targets.some((target) => target.environmentId === environmentId)) {
        registered.delete(environmentId);
      }
    }
    if (targets.length === 0) return;
    token ??= readDeviceToken().catch(() => null);
    const deviceToken = await token;
    if (deviceToken === null) {
      token = null;
      return;
    }
    for (const target of targets) {
      const key = `${deviceToken}|${target.httpBaseUrl}`;
      if (registered.get(target.environmentId) === key) continue;
      if (!/^https?:\/\//.test(target.httpBaseUrl)) continue;
      registered.set(target.environmentId, key);
      void registerDevice
        .run(appAtomRegistry, {
          environmentId: target.environmentId,
          input: {
            token: deviceToken,
            apsEnvironment,
            actionBaseUrl: target.httpBaseUrl,
            ...(bundleId ? { bundleId } : {}),
          },
        })
        .then((result) => {
          if (result._tag !== "Success" && registered.get(target.environmentId) === key) {
            registered.delete(target.environmentId);
          }
        });
    }
  };

  const unsubscribeTargets = appAtomRegistry.subscribe(
    connectedTargetsAtom,
    () => void register(),
    {
      immediate: true,
    },
  );
  // Fetching the token fires this listener too, so take the token it carries instead of refetching.
  const tokenSubscription = Notifications.addPushTokenListener((event) => {
    if (typeof event.data !== "string") return;
    token = Promise.resolve(event.data);
    void register();
  });
  // Permission granted in Settings, or a failed attempt, gets another go when the app comes back.
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") void register();
  });

  return () => {
    unsubscribeTargets();
    tokenSubscription.remove();
    appStateSubscription.remove();
  };
}
