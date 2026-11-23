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

const MAX_APPROVAL_LENGTH = 400;

export type WatchPushPhase = "waiting_for_approval" | "waiting_for_input" | "completed" | "failed";

/** The wording, read from the `text` key of config.json on every push so edits need no rebuild. */
export interface WatchPushText {
  readonly phaseLabels: Record<WatchPushPhase, string>;
  /** `{phase}` and `{thread}` are replaced. */
  readonly titleFormat: string;
  readonly bodyMaxLength: number;
  /** Also lists "1. label" above the reply, for phones without the button extension. */
  readonly listChoicesInBody: boolean;
  /** `{n}` and `{label}` are replaced; the label is clipped to `buttonMaxLength` first. */
  readonly buttonFormat: string;
  readonly buttonMaxLength: number;
}

const DEFAULT_WATCH_PUSH_TEXT: WatchPushText = {
  phaseLabels: {
    waiting_for_approval: "承認待ち",
    waiting_for_input: "質問",
    completed: "完了",
    failed: "失敗",
  },
  titleFormat: "{phase} · {thread}",
  bodyMaxLength: 700,
  listChoicesInBody: false,
  buttonFormat: "{n}. {label}",
  buttonMaxLength: 40,
};

/** Any setting that is missing or of the wrong type keeps its default. */
export function readWatchPushText(raw: unknown): WatchPushText {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = (key: string, fallback: string) =>
    typeof value[key] === "string" && value[key] !== "" ? (value[key] as string) : fallback;
  const count = (key: string, fallback: number) =>
    typeof value[key] === "number" && Number.isInteger(value[key]) && (value[key] as number) > 0
      ? (value[key] as number)
      : fallback;
  const labels =
    typeof value.phaseLabels === "object" && value.phaseLabels !== null
      ? (value.phaseLabels as Record<string, unknown>)
      : {};
  const defaults = DEFAULT_WATCH_PUSH_TEXT;
  return {
    phaseLabels: Object.fromEntries(
      Object.entries(defaults.phaseLabels).map(([phase, label]) => [
        phase,
        typeof labels[phase] === "string" && labels[phase] !== "" ? labels[phase] : label,
      ]),
    ) as Record<WatchPushPhase, string>,
    titleFormat: text("titleFormat", defaults.titleFormat),
    bodyMaxLength: count("bodyMaxLength", defaults.bodyMaxLength),
    listChoicesInBody:
      typeof value.listChoicesInBody === "boolean"
        ? value.listChoicesInBody
        : defaults.listChoicesInBody,
    buttonFormat: text("buttonFormat", defaults.buttonFormat),
    buttonMaxLength: count("buttonMaxLength", defaults.buttonMaxLength),
  };
}

const fill = (format: string, values: Record<string, string>) =>
  format.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

export interface WatchPushContent {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  /** "1. label" lines shown above `body`; payload trimming shortens `body` and keeps these whole. */
  readonly choices?: string;
  /** The phone's notification extension uses these as the button titles, as given. */
  readonly buttonTitles?: ReadonlyArray<string>;
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

export function buildWatchPushContent(
  input: {
    readonly phase: WatchPushPhase;
    readonly threadTitle: string;
    readonly projectTitle: string;
    readonly requestId: RuntimeRequestId | null;
    readonly approvalText: string | null;
    readonly assistantText: string | null;
  },
  text: WatchPushText = DEFAULT_WATCH_PUSH_TEXT,
): WatchPushContent {
  const title = fill(text.titleFormat, {
    phase: text.phaseLabels[input.phase],
    thread: input.threadTitle,
  });
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
      const reply = clip(markdown, text.bodyMaxLength);
      const choices = text.listChoicesInBody
        ? actions.map((action, index) => `${index + 1}. ${action.label}`).join("\n")
        : "";
      return {
        title,
        subtitle,
        body: reply === "" ? "作業が終わりました" : reply,
        ...(choices === "" ? {} : { choices }),
        ...(actions.length === 0
          ? {}
          : {
              buttonTitles: actions.map((action, index) =>
                fill(text.buttonFormat, {
                  n: String(index + 1),
                  label: clip(action.label, text.buttonMaxLength),
                }),
              ),
            }),
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
  const buttonTitles = input.content.buttonTitles ?? [];
  const make = (body: string) => ({
    aps: {
      alert: {
        title: clip(input.content.title, MAX_TITLE_LENGTH),
        subtitle: clip(input.content.subtitle, MAX_TITLE_LENGTH),
        body: [input.content.choices ?? "", body].filter((part) => part !== "").join("\n\n"),
      },
      sound: "default",
      "thread-id": `${input.environmentId}/${input.threadId}`,
      ...(input.content.category === null ? {} : { category: input.content.category }),
      ...(buttonTitles.length === 0 ? {} : { "mutable-content": 1 as const }),
    },
    // Expo iOS exposes userInfo.body as notification.content.data, which the app routes on.
    body: {
      environmentId: input.environmentId,
      threadId: input.threadId,
      deepLink: input.deepLink,
    },
    ...(input.actionUrl === null ? {} : { t3WatchActionUrl: input.actionUrl }),
    ...(buttonTitles.length === 0 ? {} : { t3WatchChoices: buttonTitles }),
  });
  let body = input.content.body;
  let payload = make(body);
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
