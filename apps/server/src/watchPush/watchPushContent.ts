import {
  type CommandId,
  MessageId,
  type OrchestrationV2Command,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import { splitNextActions } from "@t3tools/shared/nextActions";

// The phone registers these category ids with their buttons; keep both sides in step
// (apps/mobile/modules/t3-watch-actions/ios/T3WatchActionsSubscriber.swift).
const WATCH_PUSH_APPROVAL_CATEGORY = "t3-watch-approval";
const watchPushNextCategory = (count: number) => `t3-watch-next-${count}`;

const MAX_BODY_LENGTH = 700;
const MAX_APPROVAL_LENGTH = 400;

export type WatchPushPhase = "waiting_for_approval" | "waiting_for_input" | "completed" | "failed";

export interface WatchPushContent {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  readonly category: string | null;
  /** What the buttons act on; null when the notification has none. */
  readonly target: {
    readonly requestId: RuntimeRequestId | null;
    readonly prompts: ReadonlyArray<string>;
  } | null;
}

function clip(text: string, max: number): string {
  const characters = Array.from(text.trim());
  return characters.length <= max ? text.trim() : `${characters.slice(0, max - 1).join("")}…`;
}

const PHASE_LABEL: Record<WatchPushPhase, string> = {
  waiting_for_approval: "承認待ち",
  waiting_for_input: "質問",
  completed: "完了",
  failed: "失敗",
};

export function buildWatchPushContent(input: {
  readonly phase: WatchPushPhase;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly requestId: RuntimeRequestId | null;
  readonly approvalText: string | null;
  readonly assistantText: string | null;
}): WatchPushContent {
  const title = `${PHASE_LABEL[input.phase]} · ${input.threadTitle}`;
  const subtitle = input.projectTitle;
  switch (input.phase) {
    case "waiting_for_approval":
      return {
        title,
        subtitle,
        body: clip(input.approvalText ?? "エージェントが許可を求めています", MAX_APPROVAL_LENGTH),
        category: input.requestId === null ? null : WATCH_PUSH_APPROVAL_CATEGORY,
        target: input.requestId === null ? null : { requestId: input.requestId, prompts: [] },
      };
    case "waiting_for_input":
      return {
        title,
        subtitle,
        body: "アプリで答えてください",
        category: null,
        target: null,
      };
    case "failed":
      return {
        title,
        subtitle,
        body: "エージェントの実行が失敗しました",
        category: watchPushNextCategory(0),
        target: { requestId: null, prompts: [] },
      };
    case "completed": {
      const { markdown, actions } = splitNextActions(input.assistantText ?? "");
      const reply = clip(markdown, MAX_BODY_LENGTH);
      const choices = actions.map((action, index) => `${index + 1}. ${action.label}`).join("\n");
      const body = [reply, choices].filter((part) => part !== "").join("\n\n");
      return {
        title,
        subtitle,
        body: body === "" ? "作業が終わりました" : body,
        category: watchPushNextCategory(actions.length),
        target: { requestId: null, prompts: actions.map((action) => action.prompt) },
      };
    }
  }
}

// APNs refuses alerts over 4 KiB; leave room for the headers APNs counts into it.
const MAX_PAYLOAD_BYTES = 3800;
const MAX_TITLE_LENGTH = 120;

export function buildWatchPushApnsPayload(input: {
  readonly content: WatchPushContent;
  readonly environmentId: string;
  readonly threadId: string;
  readonly deepLink: string;
  readonly actionUrl: string | null;
}) {
  const make = (body: string) => ({
    aps: {
      alert: {
        title: clip(input.content.title, MAX_TITLE_LENGTH),
        subtitle: clip(input.content.subtitle, MAX_TITLE_LENGTH),
        body,
      },
      sound: "default",
      "thread-id": `${input.environmentId}/${input.threadId}`,
      ...(input.content.category === null ? {} : { category: input.content.category }),
    },
    // Expo iOS exposes userInfo.body as notification.content.data, which the app routes on.
    body: {
      environmentId: input.environmentId,
      threadId: input.threadId,
      deepLink: input.deepLink,
    },
    ...(input.actionUrl === null ? {} : { t3WatchActionUrl: input.actionUrl }),
  });
  let body = input.content.body;
  let payload = make(body);
  // Trim from the reply's end; the numbered choices sit at the end, so keep them when they fit.
  while (Buffer.byteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES && body.length > 1) {
    body = clip(body, Math.floor(Array.from(body).length * 0.8));
    payload = make(body);
  }
  return payload;
}

/** A notification button the phone posts back: approve or deny the request, send a next prompt, or reply. */
export type WatchPushAction =
  | { readonly type: "approve" | "deny" }
  | { readonly type: "next"; readonly index: number }
  | { readonly type: "reply"; readonly text: string };

export interface WatchPushActionTarget {
  readonly threadId: ThreadId;
  readonly requestId: RuntimeRequestId | null;
  readonly prompts: ReadonlyArray<string>;
}

/** The command a button press runs, or why it can't run. */
export function watchPushActionCommand(
  target: WatchPushActionTarget,
  action: WatchPushAction,
  commandId: CommandId,
): OrchestrationV2Command | string {
  if (action.type !== "next" && action.type !== "reply") {
    if (target.requestId === null) return "Nothing is waiting for approval.";
    return {
      type: "runtime-request.respond",
      commandId,
      threadId: target.threadId,
      requestId: target.requestId,
      decision: action.type === "approve" ? "accept" : "decline",
    };
  }
  const text =
    action.type === "reply" ? action.text.trim() : (target.prompts[action.index - 1] ?? "");
  if (text === "") return "There is nothing to send.";
  return {
    type: "message.dispatch",
    commandId,
    threadId: target.threadId,
    messageId: MessageId.make(commandId),
    text,
    attachments: [],
    dispatchMode: { type: "queue_after_active" },
    createdBy: "user",
    creationSource: "mobile",
  };
}
