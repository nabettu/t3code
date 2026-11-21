import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** A phone that takes approval and next-action pushes straight from this server over APNs. */
export const WatchPushRegisterDeviceInput = Schema.Struct({
  token: TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{32,200}$/i)),
  apsEnvironment: Schema.Literals(["sandbox", "production"]),
  /** Where the phone reaches this server; notification buttons post their action here. */
  actionBaseUrl: TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\/[^/]/)),
  /** The APNs topic; dev, preview and release builds each have their own. */
  bundleId: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/)),
  ),
});
export type WatchPushRegisterDeviceInput = typeof WatchPushRegisterDeviceInput.Type;

export class WatchPushError extends Schema.TaggedError<WatchPushError>()("WatchPushError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
