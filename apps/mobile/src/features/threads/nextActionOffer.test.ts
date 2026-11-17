import { MessageId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadFeedEntry, ThreadFeedLatestRun } from "../../lib/threadActivity";
import { resolveOfferedNextActions } from "./nextActionOffer";

const RUN = RunId.make("run-2");
const REPLY = 'Done.\n\n```next\n[{"label":"Ship it","prompt":"Open a PR"}]\n```';

function message(
  role: "user" | "assistant",
  text: string,
  overrides: { readonly runId?: RunId; readonly streaming?: boolean } = {},
): ThreadFeedEntry {
  const id = MessageId.make(`${role}-${text.length}`);
  return {
    type: "message",
    id,
    createdAt: "2026-11-17T00:00:00.000Z",
    message: {
      id,
      role,
      text,
      attachments: [],
      runId: overrides.runId ?? RUN,
      streaming: overrides.streaming ?? false,
      visibility: "local",
      sourceThreadId: ThreadId.make("thread"),
      createdAt: "2026-11-17T00:00:00.000Z",
      updatedAt: "2026-11-17T00:00:00.000Z",
    },
  };
}

const completed: ThreadFeedLatestRun = {
  runId: RUN,
  status: "completed",
  startedAt: null,
  completedAt: null,
};

describe("resolveOfferedNextActions", () => {
  it.each([
    {
      name: "offers the latest reply's actions",
      feed: [message("user", "go"), message("assistant", REPLY)],
      overrides: {},
      expected: ["Ship it"],
    },
    {
      name: "hides them while the thread works",
      feed: [message("assistant", REPLY)],
      overrides: { busy: true },
      expected: [],
    },
    {
      name: "hides them behind a pending request",
      feed: [message("assistant", REPLY)],
      overrides: { hasPendingRequest: true },
      expected: [],
    },
    {
      name: "hides them once a newer run starts",
      feed: [message("assistant", REPLY)],
      overrides: {
        latestRun: { ...completed, runId: RunId.make("run-3"), status: "running" as const },
      },
      expected: [],
    },
    {
      name: "hides them behind a newer user message",
      feed: [message("assistant", REPLY), message("user", "queued")],
      overrides: {},
      expected: [],
    },
    {
      name: "ignores a reply from an earlier run",
      feed: [message("assistant", REPLY, { runId: RunId.make("run-1") })],
      overrides: {},
      expected: [],
    },
    {
      name: "waits for the reply to finish streaming",
      feed: [message("assistant", REPLY, { streaming: true })],
      overrides: {},
      expected: [],
    },
  ])("$name", ({ feed, overrides, expected }) => {
    const actions = resolveOfferedNextActions({
      feed,
      latestRun: completed,
      busy: false,
      hasPendingRequest: false,
      ...overrides,
    });
    expect(actions.map((action) => action.label)).toEqual(expected);
  });
});
