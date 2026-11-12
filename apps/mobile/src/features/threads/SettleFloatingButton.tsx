import { useState } from "react";
import { Pressable } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  makeMutable,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SymbolView } from "../../components/ui/AppSymbol";

// One offset for the app session, shared by every mounted thread screen.
const nudge = makeMutable({ x: 0, y: 0 });
const MAX_LEFT = 240;
const MAX_UP = 160;
const BUTTON_SIZE = 52;
const RIGHT_INSET = 14;
/** Room the working control on the same row leaves free at its right end. */
export const SETTLE_FLOATING_RESERVED = RIGHT_INSET + BUTTON_SIZE + 8;
// Level with the working control's bottom edge, just above the composer.
const COMPOSER_GAP = 2;
const HEADER_GAP = 12;

function upRoom(room: number) {
  "worklet";
  return Math.min(MAX_UP, Math.max(0, room - BUTTON_SIZE - COMPOSER_GAP - HEADER_GAP));
}

/** A lifted panel pushes it up only once the lift passes the nudge, so it never jumps. */
function shownRise(nudgeY: number, room: number, lifted: number) {
  "worklet";
  return Math.min(Math.max(nudgeY, -upRoom(room)), -lifted);
}

function clamp(value: number, min: number, max: number) {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

/**
 * Bottom-right of the chat, on the working control's row; a drag nudges it out of the way.
 * The upward nudge never takes it past the room left above the composer and its panels.
 */
export function SettleFloatingButton(props: {
  readonly onPress: () => void;
  readonly lift?: SharedValue<number>;
  /** Height between the header and the composer overlay's top edge. */
  readonly room: SharedValue<number>;
}) {
  const lift = props.lift;
  const room = props.room;
  const start = useSharedValue({ x: 0, y: 0, shownY: 0 });
  const movedY = useSharedValue(false);
  const [pan] = useState(() =>
    Gesture.Pan()
      .minDistance(6)
      .onStart(() => {
        const { x, y } = nudge.get();
        start.set({ x, y, shownY: shownRise(y, room.get(), lift?.get() ?? 0) });
        movedY.set(false);
      })
      .onUpdate((event) => {
        // A sideways drag keeps the saved height, which a short room may be hiding for now.
        if (Math.abs(event.translationY) >= 6) movedY.set(true);
        const { x, y, shownY } = start.get();
        const lifted = lift?.get() ?? 0;
        const ceiling = -upRoom(room.get());
        const dragged = clamp(shownY + event.translationY, ceiling, 0);
        // Only a drag that shows past a panel's lift or a short room's ceiling replaces the
        // saved height; those limits are temporary.
        const keepSaved =
          !movedY.get() ||
          (y > -lifted && dragged >= -lifted) ||
          (y < ceiling && dragged === ceiling);
        nudge.set({
          x: clamp(x + event.translationX, -MAX_LEFT, 0),
          y: keepSaved ? y : dragged,
        });
      }),
  );
  const offsetStyle = useAnimatedStyle(() => {
    const rise = shownRise(nudge.get().y, room.get(), lift?.get() ?? 0);
    return { transform: [{ translateX: nudge.get().x }, { translateY: rise }] };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: "absolute",
            right: RIGHT_INSET,
            top: -(BUTTON_SIZE + COMPOSER_GAP),
            // Below the working control (z-20), so a nudge onto it never steals its taps.
            zIndex: 10,
          },
          offsetStyle,
        ]}
      >
        <Pressable
          accessibilityLabel="Settle thread"
          accessibilityRole="button"
          onPress={props.onPress}
          className="items-center justify-center rounded-full border border-border bg-glass-fallback shadow-md shadow-black/10 active:opacity-70"
          style={{ width: BUTTON_SIZE, height: BUTTON_SIZE }}
        >
          <SymbolView
            name={{ ios: "checkmark.circle", android: "check" }}
            size={24}
            tintColorClassName="accent-icon"
            type="monochrome"
          />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}
