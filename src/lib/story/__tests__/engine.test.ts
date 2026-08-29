import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_STORY_NODES,
  advanceStory,
  classifyScore,
  createInitialRunState,
  getNode,
  getPerformanceResponse,
  renderDecision,
  renderStoryText,
  scoreInterval,
  summarizeRun,
  validateStoryGraph,
  type IntervalPerformance,
} from "../index";

const profile = {
  runnerName: "Sam",
  relationshipName: "Mara",
  relationshipLabel: "sister",
  relationshipGender: "female" as const,
};

const strongPerformance: IntervalPerformance = {
  baseline: { distanceMeters: 120, targetTimeSeconds: 40, stops: 1, consistency: 0.75 },
  difficulty: 4,
  improvementPercent: 15,
  targetTimePercentage: 92,
  distanceMeters: 150,
  targetDistanceMeters: 140,
  stops: 0,
  consistency: 0.92,
};

const successPerformance: IntervalPerformance = {
  baseline: { distanceMeters: 120, targetTimeSeconds: 40, stops: 1, consistency: 0.75 },
  difficulty: 3,
  improvementPercent: 0,
  targetTimePercentage: 105,
  distanceMeters: 110,
  targetDistanceMeters: 120,
  stops: 1,
  consistency: 0.75,
};

const nearPerformance: IntervalPerformance = {
  baseline: { distanceMeters: 120, targetTimeSeconds: 40, stops: 1, consistency: 0.75 },
  difficulty: 3,
  improvementPercent: -10,
  targetTimePercentage: 120,
  distanceMeters: 80,
  targetDistanceMeters: 120,
  stops: 2,
  consistency: 0.5,
};

const missPerformance: IntervalPerformance = {
  baseline: { distanceMeters: 150, targetTimeSeconds: 40, stops: 0, consistency: 0.9 },
  difficulty: 3,
  improvementPercent: -20,
  targetTimePercentage: 160,
  distanceMeters: 20,
  targetDistanceMeters: 140,
  stops: 4,
  consistency: 0.2,
};

function runEpisode(
  decisionId: "rescue_together" | "signal_escape",
  finalPerformance: IntervalPerformance = strongPerformance,
  mode: "real" | "demo" = "demo",
) {
  let state = createInitialRunState({ mode, profile });
  while (!state.completed) {
    const node = getNode(state.currentNodeId, state.config);
    state = advanceStory(
      state,
      node.decision
        ? { decisionId }
        : node.isHighIntensityInterval
          ? { performance: node.id.startsWith("final_sprint") ? finalPerformance : strongPerformance }
          : {},
    );
  }
  return state;
}

test("graph proves 8-12 minute routes, a 60-90 second opening, and mode parity", () => {
  const validation = validateStoryGraph();
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(validation.realRouteSeconds >= 480 && validation.realRouteSeconds <= 720);
  assert.ok(validation.demoRouteSeconds < validation.realRouteSeconds);
  assert.equal(validation.warmupCalibrationSeconds, 90);
  assert.equal(validation.routes.length, 2);
  for (const route of validation.routes) {
    assert.equal(route.highIntensityIntervals, 3);
    assert.deepEqual(route.realNodeIds, route.demoNodeIds);
    assert.equal(route.realNodeIds.at(-1), "summary");
    assert.ok(route.realSeconds >= 480 && route.realSeconds <= 720);
    assert.ok(route.demoSeconds < route.realSeconds);
  }
});

test("story, decision, and result templates replace all supported names", () => {
  const text = renderStoryText(getNode("onboarding"), profile);
  assert.match(text, /Sam/);
  assert.match(text, /Mara/);
  assert.match(text, /sister/);
  assert.doesNotMatch(text, /\{\{/);

  const decision = renderDecision(getNode("final_choice"), profile);
  assert.ok(decision);
  assert.match(decision.prompt, /Mara/);
  assert.match(decision.options[0].description, /Mara/);
  assert.doesNotMatch(JSON.stringify(decision), /\{\{/);

  const response = getPerformanceResponse(getNode("sprint_one"), "near_miss", profile);
  assert.match(response ?? "", /Mara/);
  assert.doesNotMatch(response ?? "", /\{\{/);
});

test("relative scoring produces every classification with an auditable breakdown", () => {
  const results = [
    scoreInterval(strongPerformance),
    scoreInterval(successPerformance),
    scoreInterval(nearPerformance),
    scoreInterval(missPerformance),
  ];
  assert.deepEqual(
    results.map((result) => result.classification),
    ["strong_success", "success", "near_miss", "miss"],
  );
  for (const result of results) {
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.breakdown.baselineRelative >= 0);
    assert.ok(result.breakdown.targetTime >= 0);
    assert.ok(result.breakdown.distance >= 0);
    assert.ok(result.breakdown.stops >= 0);
    assert.ok(result.breakdown.consistency >= 0);
  }
  const sameEffortAgainstLowerBaseline = scoreInterval({
    ...successPerformance,
    baseline: { ...successPerformance.baseline, distanceMeters: 80 },
    difficulty: 5,
  });
  const sameEffortAgainstHigherBaseline = scoreInterval({
    ...successPerformance,
    baseline: { ...successPerformance.baseline, distanceMeters: 160 },
    difficulty: 1,
  });
  assert.ok(sameEffortAgainstLowerBaseline.score > sameEffortAgainstHigherBaseline.score);
  assert.equal(classifyScore(88, getNode("sprint_one").successThreshold), "strong_success");
  assert.equal(classifyScore(72, getNode("sprint_one").successThreshold), "success");
  assert.equal(classifyScore(55, getNode("sprint_one").successThreshold), "near_miss");
  assert.equal(classifyScore(54.9, getNode("sprint_one").successThreshold), "miss");
});

test("the final choice changes the third interval and ending", () => {
  const rescue = runEpisode("rescue_together");
  const escape = runEpisode("signal_escape");
  assert.ok(rescue.history.some((entry) => entry.nodeId === "final_sprint_rescue"));
  assert.ok(escape.history.some((entry) => entry.nodeId === "final_sprint_escape"));
  assert.equal(summarizeRun(rescue).outcome, "rescued_together");
  assert.equal(summarizeRun(rescue).completedIntervals, 3);
  assert.equal(summarizeRun(rescue).totalDistanceMeters, 450);
  assert.equal(summarizeRun(rescue).totalStops, 0);
  assert.equal(summarizeRun(escape).outcome, "escaped_to_safety");
  assert.equal(summarizeRun(escape).completedIntervals, 3);
});

test("a miss reaches a safe third ending without trapping the run", () => {
  const state = runEpisode("rescue_together", missPerformance);
  const summary = summarizeRun(state);
  const finalEffort = state.history.find((entry) => entry.nodeId === "final_sprint_rescue");
  assert.equal(summary.outcome, "survived_the_night");
  assert.match(summary.encouragement, /adapted|safe/i);
  assert.equal(finalEffort?.classification, "miss");
  assert.match(finalEffort?.performanceResponse ?? "", /safe|secure/i);
  assert.equal(state.currentNodeId, "summary");
  assert.equal(state.completed, true);
  assert.strictEqual(advanceStory(state), state);
});

test("every sprint is finite and all performance reactions are distinct and failure-forward", () => {
  const classifications = ["strong_success", "success", "near_miss", "miss"] as const;
  for (const node of Object.values(BASE_STORY_NODES)) {
    if (!node.isHighIntensityInterval) continue;
    assert.ok(node.intendedDuration.realSeconds > 0 && node.intendedDuration.realSeconds <= 60);
    assert.ok(node.intendedDuration.demoSeconds > 0);
    const responses = classifications.map((classification) =>
      getPerformanceResponse(node, classification, profile),
    );
    assert.ok(responses.every(Boolean));
    assert.equal(new Set(responses).size, 4);
  }

  assert.match(renderStoryText(getNode("recovery_one"), profile), /Sam.*Breathe/);
  assert.match(renderStoryText(getNode("recovery_two"), profile), /safe for now/);
});

test("character dialogue is explicitly cast while action remains with the narrator", () => {
  for (const id of [
    "recovery_one",
    "recovery_two",
    "final_choice",
    "final_sprint_rescue",
    "ending_rescue",
    "ending_escape",
    "ending_survive",
  ] as const) {
    assert.equal(getNode(id).speaker, "relationship", `${id} should use the character voice`);
  }

  for (const id of ["easy_start", "sprint_one", "sprint_two", "final_sprint_escape"] as const) {
    assert.equal(getNode(id).speaker, undefined, `${id} should stay with the narrator`);
  }
});

test("movement copy avoids unsafe or shaming commands", () => {
  const movementCopy = Object.values(BASE_STORY_NODES)
    .flatMap((node) => [
      node.storyText,
      node.targetEffort.cue,
      ...Object.values(node.performanceResponses ?? {}),
    ])
    .join(" ")
    .toLowerCase();

  for (const phrase of [
    "push through pain",
    "don't stop",
    "do not stop",
    "until you collapse",
    "too slow",
    "you are weak",
    "you failed",
  ]) {
    assert.doesNotMatch(movementCopy, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
