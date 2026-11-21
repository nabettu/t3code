import {
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
import * as Stream from "effect/Stream";

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
}

const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
// A run can finish and another start right away; only a completion that holds gets a push.
const COMPLETION_CONFIRM_DELAY = "5 seconds";
const JWT_REFRESH_SECONDS = 50 * 60;

export class WatchPush extends Context.Service<
  WatchPush,
  {
    readonly registerDevice: (
      input: WatchPushRegisterDeviceInput,
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
  const random = yield* SecureRandom.SecureRandom;
  const scope = yield* Effect.scope;
  const directory = watchPushDirectory();

  const targets = new Map<string, ActionTarget>();
  const pushedByThread = new Map<ThreadId, string>();
  const heldCompletions = new Map<ThreadId, RunId | null>();
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

  const newToken = random
    .randomBytes(24)
    .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("base64url")));

  const readThreadState = Effect.fnUntraced(function* (threadId: ThreadId) {
    const snapshot = yield* threads.getAgentAwarenessSnapshot(threadId);
    const thread = snapshot.threads.find((candidate) => candidate.id === threadId) ?? null;
    if (thread === null || thread.archivedAt !== null) return null;
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
    const config = yield* Effect.promise(() => readWatchPushConfig(directory));
    if (config === null) return;
    const devices = yield* Effect.promise(() => readWatchPushDevices(directory));
    if (devices.length === 0) return;
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
    const token = content.target === null ? null : yield* newToken;
    if (content.target !== null && token !== null) {
      targets.set(token, {
        threadId: input.threadId,
        requestId: content.target.requestId,
        prompts: content.target.prompts,
        expiresAtMs: now + ACTION_TTL_MS,
      });
    }
    const jwt = jwtFor(config, Math.floor(now / 1000));
    const dead: Array<string> = [];
    for (const device of devices) {
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
          sendApnsAlert({
            config,
            jwt,
            device,
            payload,
            collapseId: `${input.threadId}`.slice(0, 64),
          }),
        catch: () => failure("APNs did not answer."),
      }).pipe(Effect.option);
      if (Option.isNone(result)) {
        yield* Effect.logWarning("watch push delivery failed", { threadId: input.threadId });
        continue;
      }
      if (result.value.status !== 200) {
        yield* Effect.logWarning("watch push rejected by APNs", {
          threadId: input.threadId,
          status: result.value.status,
          reason: result.value.reason,
        });
        if (isDeadApnsToken(result.value)) dead.push(device.token);
      }
    }
    if (dead.length > 0) {
      yield* Effect.promise(() =>
        writeWatchPushDevices(
          directory,
          devices.filter((device) => !dead.includes(device.token)),
        ),
      );
    }
  });

  // Set once the worker exists; a held completion re-enters the worker after its delay.
  let enqueue: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

  const evaluate = Effect.fnUntraced(function* (threadId: ThreadId) {
    const current = yield* readThreadState(threadId).pipe(Effect.orElseSucceed(() => null));
    if (current === null) {
      heldCompletions.delete(threadId);
      return;
    }
    const identity = pushIdentity(current.phase, current.thread);
    if (pushedByThread.get(threadId) === identity) return;
    if (current.phase === "completed") {
      const held = heldCompletions.get(threadId);
      if (held === undefined || held !== current.thread.latestRunId) {
        heldCompletions.set(threadId, current.thread.latestRunId);
        yield* Effect.forkIn(
          Effect.sleep(COMPLETION_CONFIRM_DELAY).pipe(
            Effect.andThen(Effect.suspend(() => enqueue(threadId))),
          ),
          scope,
        );
        return;
      }
    }
    heldCompletions.delete(threadId);
    pushedByThread.set(threadId, identity);
    yield* deliver({
      threadId,
      phase: current.phase,
      thread: current.thread,
      state: current.state,
    });
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
  ) {
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.tryPromise({
      try: async () => {
        const devices = await readWatchPushDevices(directory);
        await writeWatchPushDevices(directory, [
          ...devices.filter((device) => device.token !== input.token),
          { ...input, updatedAt },
        ]);
      },
      catch: () => failure("Couldn't save the device for watch notifications."),
    });
    return {};
  });

  const dispatchFailure = () => failure("The thread didn't take the action.");

  const runAction = Effect.fn("WatchPush.runAction")(function* (
    token: string,
    action: WatchPushAction,
  ) {
    const target = targets.get(token);
    if (target === undefined || target.expiresAtMs <= (yield* nowMs)) {
      targets.delete(token);
      return yield* failure("This notification has expired.");
    }
    const command = watchPushActionCommand(target, action, CommandId.make(`watch-push:${token}`));
    if (typeof command === "string") return yield* failure(command);
    yield* threads.dispatch(command).pipe(Effect.mapError(dispatchFailure));
    targets.delete(token);
  });

  return WatchPush.of({ registerDevice, runAction });
});

export const layer = Layer.effect(WatchPush, make);
