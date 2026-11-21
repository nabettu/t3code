import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { WATCH_PUSH_ACTION_ROUTE_PREFIX, WatchPush } from "./WatchPush.ts";

const WatchPushActionBody = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["approve", "deny"]) }),
  Schema.Struct({
    type: Schema.Literal("next"),
    index: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 })),
  }),
  Schema.Struct({
    type: Schema.Literal("reply"),
    text: Schema.String.check(Schema.isMaxLength(4000)),
  }),
]);
const decodeBody = Schema.decodeUnknownEffect(WatchPushActionBody);

// The token in the path is the credential: a random one-shot value that only the notification
// it was minted for carries, so a phone acting from the lock screen needs no session.
export const layerWatchPushActionRoute = HttpRouter.add(
  "POST",
  `${WATCH_PUSH_ACTION_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = Option.fromNullishOr(
      new URL(request.url, "http://localhost").pathname
        .slice(WATCH_PUSH_ACTION_ROUTE_PREFIX.length + 1)
        .match(/^[A-Za-z0-9_-]{16,64}$/)?.[0],
    );
    if (Option.isNone(token)) return HttpServerResponse.text("Not Found", { status: 404 });
    const body = yield* request.json.pipe(Effect.flatMap(decodeBody), Effect.option);
    if (Option.isNone(body)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const watchPush = yield* WatchPush;
    return yield* watchPush.runAction(token.value, body.value).pipe(
      Effect.as(HttpServerResponse.empty({ status: 204 })),
      Effect.catch((error) =>
        Effect.succeed(HttpServerResponse.text(error.detail, { status: 409 })),
      ),
    );
  }),
);
