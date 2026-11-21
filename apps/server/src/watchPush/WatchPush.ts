// @effect-diagnostics nodeBuiltinImport:off -- Only joins the device list path under the state directory.
import * as NodePath from "node:path";

import {
  AuthOrchestrationOperateScope,
  type AuthSessionId,
  CommandId,
  type ThreadId,
  type RunId,
  type RuntimeRequestId,
  WatchPushError,
  type WatchPushRegisterDeviceInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { AgentAwarenessThread } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  makeAgentAwarenessPublishWorker,
  resolveAgentAwarenessRelayPublishSnapshot,
  shouldPublishAgentAwarenessEvent,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import {
  isDeadApnsToken,
  makeApnsJwt,
  readWatchPushConfig,
  readWatchPushDevices,
  sendApnsAlert,
  watchPushDirectory,
  writeWatchPushDevices,
  type WatchPushApnsConfig,
  type WatchPushDevice,
} from "./apns.ts";
import {
  buildWatchPushApnsPayload,
  buildWatchPushContent,
  watchPushActionCommand,
  type WatchPushAction,
  type WatchPushActionTarget,
  type WatchPushPhase,
} from "./watchPushContent.ts";

export const WATCH_PUSH_ACTION_ROUTE_PREFIX = "/api/watch-push/action";

interface ActionTarget extends WatchPushActionTarget {
  readonly expiresAtMs: number;
  /** The session of the one device this token was sent to; the press only counts while it lives. */
  readonly sessionId: string;
  /** Shared by every device's token for one notification: the first press answers for all. */
  readonly notificationId: string;
}

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
// A run can finish and another start right away; only a completion that holds gets a push.
const COMPLETION_CONFIRM_MS = 5_000;
const JWT_REFRESH_SECONDS = 50 * 60;

export class WatchPush extends Context.Service<
  WatchPush,
  {
    readonly registerDevice: (
      input: WatchPushRegisterDeviceInput,
      sessionId: AuthSessionId,
    ) => Effect.Effect<Record<string, never>, WatchPushError>;
    readonly runAction: (
      token: string,
      action: WatchPushAction,
    ) => Effect.Effect<void, WatchPushError>;
  }
>()("t3/watchPush/WatchPush") {}

const PUSH_PHASES = new Set<string>([
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
]);

function pushIdentity(phase: WatchPushPhase, thread: AgentAwarenessThread): string {
  return phase === "waiting_for_approval" || phase === "waiting_for_input"
    ? `${phase}:${thread.pendingRuntimeRequest?.id ?? "none"}`
    : `${phase}:${thread.latestRunId ?? "none"}`;
}

const failure = (detail: string) => new WatchPushError({ detail });

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const random = yield* SecureRandom.SecureRandom;
  const scope = yield* Effect.scope;
  const keyDirectory = watchPushDirectory();
  // Devices belong to this server's state, so a dev server beside the desktop one never reaches them.
  const devicesFile = NodePath.join(serverConfig.stateDir, "watch-push-devices.json");
  const devicesLock = yield* Semaphore.make(1);

  const targets = new Map<string, ActionTarget>();
  const pushedByThread = new Map<ThreadId, string>();
  const heldCompletions = new Map<
    ThreadId,
    { readonly runId: RunId | null; readonly readyAtMs: number }
  >();
  let jwtCache: { readonly keyId: string; readonly jwt: string; readonly issuedAt: number } | null =
    null;

  const nowMs = Effect.map(DateTime.now, DateTime.toEpochMillis);

  const jwtFor = (config: WatchPushApnsConfig, nowSeconds: number) => {
    if (
      jwtCache === null ||
      jwtCache.keyId !== config.keyId ||
      nowSeconds - jwtCache.issuedAt > JWT_REFRESH_SECONDS
    ) {
      jwtCache = {
        keyId: config.keyId,
        jwt: makeApnsJwt(config, nowSeconds),
        issuedAt: nowSeconds,
      };
    }
    return jwtCache.jwt;
  };

  const randomText = (size: number) =>
    random.randomBytes(size).pipe(Effect.map((bytes) => Buffer.from(bytes).toString("base64url")));

  const readDevices = Effect.tryPromise({
    try: () => readWatchPushDevices(devicesFile),
    catch: () => failure("The watch notification device list is unreadable."),
  });

  const updateDevices = (update: (devices: Array<WatchPushDevice>) => Array<WatchPushDevice>) =>
    devicesLock.withPermits(1)(
      Effect.gen(function* () {
        const devices = yield* readDevices;
        const suffix = yield* randomText(6);
        yield* Effect.tryPromise({
          try: () => writeWatchPushDevices(devicesFile, update(devices), suffix),
          catch: () => failure("Couldn't save the device for watch notifications."),
        });
      }).pipe(Effect.uninterruptible),
    );

  const operateSessionIds = auth.listSessions().pipe(
    Effect.mapError(() => failure("Couldn't read sessions.")),
    Effect.map(
      (sessions) =>
        new Set(
          sessions
            .filter((session) => session.scopes.includes(AuthOrchestrationOperateScope))
            .map((session) => String(session.sessionId)),
        ),
    ),
  );

  // A device stops getting pushes once the session that registered it is revoked or loses operate access.
  const liveDevices = Effect.gen(function* () {
    const devices = yield* readDevices;
    if (devices.length === 0) return devices;
    const allowed = yield* operateSessionIds;
    return devices.filter((device) => allowed.has(device.sessionId));
  });

  const readThreadState = Effect.fnUntraced(function* (
    threadId: ThreadId,
    options: { readonly ignoreSettled: boolean },
  ) {
    const snapshot = yield* threads.getAgentAwarenessSnapshot(threadId);
    const found = snapshot.threads.find((candidate) => candidate.id === threadId) ?? null;
    if (found === null || found.archivedAt !== null) return null;
    // A completion settled while it was held still counts, as the relay treats it.
    const thread =
      options.ignoreSettled && found.settledOverride === "settled"
        ? { ...found, settledOverride: null }
        : found;
    const project = yield* projects.getById(thread.projectId);
    const resolved = resolveAgentAwarenessRelayPublishSnapshot({
      environmentId: yield* serverEnvironment.getEnvironmentId,
      thread: Option.some(thread),
      project,
      pendingSubagentRequest: null,
    });
    const state = resolved.state;
    if (state === null || !PUSH_PHASES.has(state.phase)) return null;
    return { thread, state, phase: state.phase as WatchPushPhase };
  });

  const readApprovalText = Effect.fnUntraced(function* (
    threadId: ThreadId,
    requestId: RuntimeRequestId,
  ) {
    const records = yield* threads.getThreadRecords(threadId, ["turnItems"], {
      turnItemTypes: ["approval_request"],
      messageRoles: [],
    });
    const item = records.turnItems.find(
      (candidate) => candidate.type === "approval_request" && candidate.requestId === requestId,
    );
    return item?.type === "approval_request" ? (item.prompt ?? item.reason ?? null) : null;
  });

  const readAssistantText = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    const records = yield* threads.getThreadRecords(threadId, ["messages"], {
      messageRoles: ["assistant"],
      messageRunIds: [runId],
    });
    const last = records.messages.findLast((message) => message.text.trim() !== "");
    return last?.text ?? null;
  });

  /** True once at least one phone took the push, so a failed attempt is tried again later. */
  const deliver = Effect.fn("WatchPush.deliver")(function* (input: {
    readonly threadId: ThreadId;
    readonly phase: WatchPushPhase;
    readonly thread: AgentAwarenessThread;
    readonly state: {
      readonly threadTitle: string;
      readonly projectTitle: string;
      readonly deepLink: string;
      readonly environmentId: string;
    };
  }) {
    const config = yield* Effect.promise(() => readWatchPushConfig(keyDirectory));
    if (config === null) return false;
    const devices = yield* liveDevices;
    if (devices.length === 0) return false;
    const requestId = input.thread.pendingRuntimeRequest?.id ?? null;
    const content = buildWatchPushContent({
      phase: input.phase,
      threadTitle: input.state.threadTitle,
      projectTitle: input.state.projectTitle,
      requestId: input.phase === "waiting_for_approval" ? requestId : null,
      approvalText:
        input.phase === "waiting_for_approval" && requestId !== null
          ? yield* readApprovalText(input.threadId, requestId).pipe(
              Effect.orElseSucceed(() => null),
            )
          : null,
      assistantText:
        input.phase === "completed" && input.thread.latestRunId !== null
          ? yield* readAssistantText(input.threadId, input.thread.latestRunId).pipe(
              Effect.orElseSucceed(() => null),
            )
          : null,
    });
    const now = yield* nowMs;
    for (const [token, target] of targets) {
      if (target.expiresAtMs <= now) targets.delete(token);
    }
    const jwt = jwtFor(config, Math.floor(now / 1000));
    const dead = new Set<string>();
    let delivered = false;
    const notificationId = yield* randomText(12);
    for (const device of devices) {
      // One token per device, so each press is checked against that device's own session.
      const token = content.target === null ? null : yield* randomText(24);
      if (content.target !== null && token !== null) {
        targets.set(token, {
          threadId: input.threadId,
          requestId: content.target.requestId,
          prompts: content.target.prompts,
          expiresAtMs: now + ACTION_TTL_MS,
          sessionId: device.sessionId,
          notificationId,
        });
      }
      const payload = buildWatchPushApnsPayload({
        content,
        environmentId: input.state.environmentId,
        threadId: input.threadId,
        deepLink: input.state.deepLink,
        actionUrl:
          token === null
            ? null
            : `${device.actionBaseUrl.replace(/\/+$/, "")}${WATCH_PUSH_ACTION_ROUTE_PREFIX}/${token}`,
      });
      const result = yield* Effect.tryPromise({
        try: () =>
          sendApnsAlert({ config, jwt, device, payload, collapseId: input.threadId.slice(0, 64) }),
        catch: () => failure("APNs did not answer."),
      }).pipe(Effect.option);
      if (Option.isNone(result)) {
        yield* Effect.logWarning("watch push delivery failed", { threadId: input.threadId });
        continue;
      }
      if (result.value.status === 200) {
        delivered = true;
        continue;
      }
      yield* Effect.logWarning("watch push rejected by APNs", {
        threadId: input.threadId,
        status: result.value.status,
        reason: result.value.reason,
      });
      if (isDeadApnsToken(result.value)) dead.add(device.token);
    }
    if (dead.size > 0) {
      yield* updateDevices((current) => current.filter((device) => !dead.has(device.token)));
    }
    return delivered;
  });

  // Set once the worker exists; a held completion re-enters the worker after its delay.
  let enqueue: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

  const evaluate = Effect.fnUntraced(function* (threadId: ThreadId) {
    const held = heldCompletions.get(threadId);
    const current = yield* readThreadState(threadId, { ignoreSettled: held !== undefined }).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (current === null) {
      heldCompletions.delete(threadId);
      return;
    }
    const identity = pushIdentity(current.phase, current.thread);
    if (pushedByThread.get(threadId) === identity) return;
    if (current.phase === "completed") {
      const now = yield* nowMs;
      if (held === undefined || held.runId !== current.thread.latestRunId) {
        heldCompletions.set(threadId, {
          runId: current.thread.latestRunId,
          readyAtMs: now + COMPLETION_CONFIRM_MS,
        });
        yield* Effect.forkIn(
          Effect.sleep(COMPLETION_CONFIRM_MS).pipe(
            Effect.andThen(Effect.suspend(() => enqueue(threadId))),
          ),
          scope,
        );
        return;
      }
      if (now < held.readyAtMs) return;
    }
    heldCompletions.delete(threadId);
    const delivered = yield* deliver({
      threadId,
      phase: current.phase,
      thread: current.thread,
      state: current.state,
    });
    if (delivered) pushedByThread.set(threadId, identity);
  });

  const worker = yield* makeAgentAwarenessPublishWorker((threadId: ThreadId) =>
    evaluate(threadId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("watch push evaluation failed", { threadId, cause }),
      ),
    ),
  );
  enqueue = worker.enqueue;

  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      shouldPublishAgentAwarenessEvent(event) ? worker.enqueue(event.threadId) : Effect.void,
    ),
  );

  const registerDevice = Effect.fn("WatchPush.registerDevice")(function* (
    input: WatchPushRegisterDeviceInput,
    sessionId: AuthSessionId,
  ) {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* updateDevices((devices) => [
      ...devices.filter((device) => device.token !== input.token),
      { ...input, sessionId, updatedAt },
    ]);
    return {};
  });

  const dispatchFailure = () => failure("The thread didn't take the action.");

  const claimNotification = (notificationId: string) => {
    const claimed: Array<[string, ActionTarget]> = [];
    for (const [token, target] of targets) {
      if (target.notificationId !== notificationId) continue;
      claimed.push([token, target]);
      targets.delete(token);
    }
    return () => {
      for (const [token, target] of claimed) targets.set(token, target);
    };
  };

  const runAction = Effect.fn("WatchPush.runAction")(function* (
    token: string,
    action: WatchPushAction,
  ) {
    const target = targets.get(token);
    const now = yield* nowMs;
    if (target === undefined || target.expiresAtMs <= now) {
      targets.delete(token);
      return yield* failure("This notification has expired or was already answered.");
    }
    // Claimed synchronously, before anything async, so a second press or phone finds it gone.
    const release = claimNotification(target.notificationId);
    const command = watchPushActionCommand(
      target,
      action,
      CommandId.make(`watch-push:${target.notificationId}`),
    );
    if (typeof command === "string") {
      release();
      return yield* failure(command);
    }
    yield* Effect.uninterruptible(
      operateSessionIds.pipe(
        Effect.flatMap((allowed) =>
          allowed.has(target.sessionId)
            ? threads.dispatch(command).pipe(
                Effect.mapError(dispatchFailure),
                Effect.tapError(() => Effect.sync(release)),
              )
            : Effect.sync(release).pipe(
                Effect.andThen(Effect.sync(() => targets.delete(token))),
                Effect.andThen(Effect.fail(failure("This phone's connection was revoked."))),
              ),
        ),
      ),
    );
  });

  return WatchPush.of({ registerDevice, runAction });
});

export const layer = Layer.effect(WatchPush, make);
