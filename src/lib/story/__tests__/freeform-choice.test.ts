import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackStoryContinuation,
  isCanonicalStoryChoice,
} from "../freeform-choice";

test("maps rooftop and signal language to the evacuation branch", () => {
  const continuation = fallbackStoryContinuation(
    "I climb to the roof and use the radio as a beacon",
    "Mara",
  );

  assert.equal(continuation.routeId, "signal_escape");
  assert.equal(continuation.routeLabel, "Light the flare");
  assert.match(continuation.reply, /Mara/);
});
test("keeps other freeform actions on the together branch", () => {
  const continuation = fallbackStoryContinuation(
    "I roll a toolbox under the door and pull the release",
    "Mara",
  );

  assert.equal(continuation.routeId, "rescue_together");
  assert.equal(continuation.routeLabel, "Go back together");
});

test("only accepts decisions in the validated story graph", () => {
  assert.equal(isCanonicalStoryChoice("rescue_together"), true);
  assert.equal(isCanonicalStoryChoice("signal_escape"), true);
  assert.equal(isCanonicalStoryChoice("invent_a_third_sprint"), false);
});
