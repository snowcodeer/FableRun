import { BASE_STORY_NODES, DEFAULT_STORY_CONFIG, createStoryNodes } from "./nodes";
import type {
  AdvanceStoryInput,
  IntervalPerformance,
  IntervalScore,
  PerformanceClassification,
  RunMode,
  RunnerProfile,
  RunState,
  RunSummary,
  ScoreBreakdown,
  StoryDecision,
  StoryEngineConfig,
  StoryGraphValidation,
  StoryNode,
  StoryNodeId,
  SuccessThresholds,
} from "./types";

const CLASSIFICATION_KEYS: readonly PerformanceClassification[] = [
  "strong_success",
  "success",
  "near_miss",
  "miss",
];

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));

const ratio = (value: number, denominator: number, fallback = 1): number =>
  denominator > 0 ? value / denominator : fallback;

export function normalizeStoryConfig(
  config: Partial<StoryEngineConfig> = {},
): StoryEngineConfig {
  return {
    ...DEFAULT_STORY_CONFIG,
    ...config,
    difficulty: clamp(config.difficulty ?? DEFAULT_STORY_CONFIG.difficulty, 1, 5),
    realDurationScale: Math.max(0.05, config.realDurationScale ?? 1),
    demoDurationScale: Math.max(0.05, config.demoDurationScale ?? 1),
    thresholdOffset: clamp(config.thresholdOffset ?? 0, -25, 25),
    nodeOverrides: config.nodeOverrides,
  };
}

export function createInitialRunState(options: {
  mode?: RunMode;
  profile: RunnerProfile;
  config?: Partial<StoryEngineConfig>;
}): RunState {
  return {
    mode: options.mode ?? "real",
    profile: options.profile,
    config: normalizeStoryConfig(options.config),
    currentNodeId: "onboarding",
    elapsedSeconds: 0,
    scores: [],
    totalDistanceMeters: 0,
    totalStops: 0,
    classifications: {
      strong_success: 0,
      success: 0,
      near_miss: 0,
      miss: 0,
    },
    decisions: {},
    history: [],
    completed: false,
  };
}

export function getNode(
  id: StoryNodeId,
  config: Partial<StoryEngineConfig> = {},
): StoryNode {
  const normalized = normalizeStoryConfig(config);
  return createStoryNodes(normalized)[id];
}

export function getNodeDuration(node: StoryNode, mode: RunMode, config: StoryEngineConfig): number {
  const duration = mode === "demo" ? node.intendedDuration.demoSeconds : node.intendedDuration.realSeconds;
  const scale = mode === "demo" ? config.demoDurationScale : config.realDurationScale;
  return Math.max(1, Math.round(duration * scale));
}

export function renderTemplate(template: string, profile: RunnerProfile): string {
  const replacements: Record<string, string> = {
    runnerName: profile.runnerName.trim() || "Runner",
    relationshipName: profile.relationshipName.trim() || "your person",
    relationshipLabel: profile.relationshipLabel.trim() || "friend",
  };

  return template.replace(/\{\{(runnerName|relationshipName|relationshipLabel)\}\}/g, (_, key: string) =>
    replacements[key] ?? "",
  );
}

export function renderStoryText(node: StoryNode, profile: RunnerProfile): string {
  return renderTemplate(node.storyText, profile);
}

export function renderDecision(node: StoryNode, profile: RunnerProfile): StoryDecision | null {
  if (!node.decision) return null;
  return {
    prompt: renderTemplate(node.decision.prompt, profile),
    options: node.decision.options.map((option) => ({
      ...option,
      label: renderTemplate(option.label, profile),
      description: renderTemplate(option.description, profile),
    })),
  };
}

export function getPerformanceResponse(
  node: StoryNode,
  classification: PerformanceClassification,
  profile: RunnerProfile,
): string | null {
  const response = node.performanceResponses?.[classification];
  return response ? renderTemplate(response, profile) : null;
}

export function classifyScore(
  score: number,
  thresholds: SuccessThresholds,
  thresholdOffset = 0,
): PerformanceClassification {
  if (score >= thresholds.strongSuccess + thresholdOffset) return "strong_success";
  if (score >= thresholds.success + thresholdOffset) return "success";
  if (score >= thresholds.nearMiss + thresholdOffset) return "near_miss";
  return "miss";
}

export function scoreInterval(
  performance: IntervalPerformance,
  thresholds: SuccessThresholds = BASE_STORY_NODES.sprint_one.successThreshold,
  thresholdOffset = 0,
): IntervalScore {
  const difficulty = clamp(performance.difficulty ?? DEFAULT_STORY_CONFIG.difficulty, 1, 5);
  const actualTimeSeconds =
    performance.baseline.targetTimeSeconds * (Math.max(performance.targetTimePercentage, 1) / 100);
  const actualSpeed = ratio(performance.distanceMeters, actualTimeSeconds, 0);
  const baselineSpeed = ratio(
    performance.baseline.distanceMeters,
    performance.baseline.targetTimeSeconds,
    0,
  );
  const baselineRelative = clamp(ratio(actualSpeed, baselineSpeed), 0, 1.25) * 20;
  const improvement = clamp((performance.improvementPercent + 20) / 40, 0, 1) * 15;
  const targetTime = clamp(100 / Math.max(performance.targetTimePercentage, 1), 0, 1.25) * 20;
  const distance = clamp(ratio(performance.distanceMeters, performance.targetDistanceMeters), 0, 1.25) * 20;
  const stopsRelativeToBaseline = performance.baseline.stops - performance.stops;
  const stops = clamp(0.75 + stopsRelativeToBaseline * 0.15 - performance.stops * 0.1, 0, 1) * 10;
  const consistency = clamp(
    performance.consistency * 0.7 + performance.baseline.consistency * 0.3,
    0,
    1,
  ) * 15;
  const difficultyAdjustment = (difficulty - 3) * 2;

  const breakdown: ScoreBreakdown = {
    baselineRelative,
    improvement,
    targetTime,
    distance,
    stops,
    consistency,
    difficultyAdjustment,
  };
  const score = Math.round(
    clamp(Object.values(breakdown).reduce((total, component) => total + component, 0), 0, 100) * 10,
  ) / 10;

  return {
    score,
    classification: classifyScore(score, thresholds, thresholdOffset),
    breakdown,
  };
}

function resolveTransition(node: StoryNode, classification: PerformanceClassification): StoryNodeId {
  switch (classification) {
    case "strong_success":
      return node.transitions.strongSuccess;
    case "success":
      return node.transitions.success;
    case "near_miss":
      return node.transitions.near;
    case "miss":
      return node.transitions.failure;
  }
}

export function advanceStory(state: RunState, input: AdvanceStoryInput = {}): RunState {
  if (state.completed) return state;

  const nodes = createStoryNodes(state.config);
  const node = nodes[state.currentNodeId];
  let intervalScore: IntervalScore | null = null;
  let classification: PerformanceClassification = "success";
  let nextNodeId: StoryNodeId;
  let decisionId: string | undefined;

  if (node.decision) {
    const selected = node.decision.options.find((option) => option.id === input.decisionId);
    if (!selected) {
      const validChoices = node.decision.options.map((option) => option.id).join(", ");
      throw new Error(`Decision ${node.id} requires one of: ${validChoices}`);
    }
    decisionId = selected.id;
    nextNodeId = selected.nextNodeId;
  } else {
    if (input.performance) {
      intervalScore = scoreInterval(
        { ...input.performance, difficulty: input.performance.difficulty ?? state.config.difficulty },
        node.successThreshold,
        state.config.thresholdOffset,
      );
      classification = intervalScore.classification;
    }
    nextNodeId = resolveTransition(node, classification);
  }

  const elapsedSeconds = Math.max(
    0,
    input.elapsedSeconds ?? getNodeDuration(node, state.mode, state.config),
  );
  const classifications = { ...state.classifications };
  if (intervalScore) classifications[classification] += 1;
  const performanceResponse = intervalScore
    ? getPerformanceResponse(node, classification, state.profile)
    : null;

  return {
    ...state,
    currentNodeId: nextNodeId,
    elapsedSeconds: state.elapsedSeconds + elapsedSeconds,
    scores: intervalScore ? [...state.scores, intervalScore.score] : state.scores,
    totalDistanceMeters: state.totalDistanceMeters + (input.performance?.distanceMeters ?? 0),
    totalStops: state.totalStops + (input.performance?.stops ?? 0),
    classifications,
    decisions: decisionId ? { ...state.decisions, [node.id]: decisionId } : state.decisions,
    history: [
      ...state.history,
      {
        nodeId: node.id,
        nextNodeId,
        classification,
        score: intervalScore?.score ?? null,
        performanceResponse,
        decisionId,
        elapsedSeconds,
      },
    ],
    completed: nodes[nextNodeId].isTerminal === true,
  };
}

export function getRunOutcome(state: RunState): RunSummary["outcome"] {
  const visited = new Set(state.history.map((entry) => entry.nextNodeId));
  if (visited.has("ending_rescue")) return "rescued_together";
  if (visited.has("ending_escape")) return "escaped_to_safety";
  if (visited.has("ending_survive")) return "survived_the_night";
  return "in_progress";
}

export function summarizeRun(state: RunState): RunSummary {
  const outcome = getRunOutcome(state);
  const outcomeCopy: Record<RunSummary["outcome"], [string, string]> = {
    rescued_together: [
      "Together at the gate",
      `${state.profile.runnerName} reached ${state.profile.relationshipName} before the shutters closed.`,
    ],
    escaped_to_safety: [
      "Flare over the city",
      `${state.profile.runnerName} secured evacuation for ${state.profile.relationshipName}.`,
    ],
    survived_the_night: [
      "The doors held",
      `${state.profile.runnerName} found cover and kept ${state.profile.relationshipName} on the radio.`,
    ],
    in_progress: ["Transmission active", "The current chapter is still in progress."],
  };
  const averageScore = state.scores.length
    ? Math.round((state.scores.reduce((total, score) => total + score, 0) / state.scores.length) * 10) / 10
    : null;

  return {
    outcome,
    outcomeTitle: outcomeCopy[outcome][0],
    outcomeText: outcomeCopy[outcome][1],
    averageScore,
    bestScore: state.scores.length ? Math.max(...state.scores) : null,
    completedIntervals: state.history.filter((entry) =>
      createStoryNodes(state.config)[entry.nodeId].isHighIntensityInterval,
    ).length,
    totalDistanceMeters: state.totalDistanceMeters,
    totalStops: state.totalStops,
    elapsedSeconds: state.elapsedSeconds,
    decisions: state.decisions,
    encouragement: getSummaryEncouragement(state, outcome),
  };
}

function getSummaryEncouragement(
  state: RunState,
  outcome: RunSummary["outcome"],
): string {
  if (outcome === "in_progress") return "Stay controlled and choose the safest pace for you.";
  if (state.classifications.miss > 0) {
    return "You adapted without forcing the pace. Safe decisions kept the story moving.";
  }
  if (state.classifications.strong_success > 0) {
    return "You found another gear while staying in control. Recover well.";
  }
  if (state.classifications.success > 0) {
    return "You held a strong, controlled effort. Recovery is part of the story.";
  }
  return "Chapter complete. Recovery is part of the story.";
}

export function validateStoryGraph(
  config: Partial<StoryEngineConfig> = {},
): StoryGraphValidation {
  const normalized = normalizeStoryConfig(config);
  const nodes = createStoryNodes(normalized);
  const errors: string[] = [];
  const nodeIds = Object.keys(nodes) as StoryNodeId[];
  const highIntensityNodeIds = nodeIds.filter((id) => nodes[id].isHighIntensityInterval);
  const warmupCalibrationSeconds =
    nodes.calibration.intendedDuration.realSeconds + nodes.easy_start.intendedDuration.realSeconds;

  for (const node of Object.values(nodes)) {
    for (const [transitionName, target] of Object.entries(node.transitions) as Array<
      [string, StoryNodeId]
    >) {
      if (!nodes[target]) errors.push(`${node.id}.${transitionName} points to missing node ${target}`);
    }
    for (const option of node.decision?.options ?? []) {
      if (!nodes[option.nextNodeId]) errors.push(`${node.id}.${option.id} points to missing node ${option.nextNodeId}`);
    }
    if (node.musicIntensity < 0 || node.musicIntensity > 1) {
      errors.push(`${node.id}.musicIntensity must be between 0 and 1`);
    }
    if (node.targetEffort.rpe < 1 || node.targetEffort.rpe > 10) {
      errors.push(`${node.id}.targetEffort.rpe must be between 1 and 10`);
    }
    if (node.intendedDuration.realSeconds <= 0 || node.intendedDuration.demoSeconds <= 0) {
      errors.push(`${node.id} must have finite positive durations`);
    }
    if (node.isHighIntensityInterval) {
      if (!node.performanceResponses) {
        errors.push(`${node.id} must define all performance narrative responses`);
      }
      if (node.intendedDuration.realSeconds > 60) {
        errors.push(`${node.id} must remain a short interval of 60 seconds or less`);
      }
    }
  }

  if (highIntensityNodeIds.length !== 4) {
    errors.push(`Expected four sprint branch nodes (three per route), found ${highIntensityNodeIds.length}`);
  }

  if (warmupCalibrationSeconds < 60 || warmupCalibrationSeconds > 90) {
    errors.push(
      `Calibration and warm-up must total 60-90 seconds; received ${warmupCalibrationSeconds}`,
    );
  }

  const route = (choice: "rescue_together" | "signal_escape", mode: RunMode) => {
    let state = createInitialRunState({
      mode,
      profile: {
        runnerName: "Runner",
        relationshipName: "Alex",
        relationshipLabel: "friend",
        relationshipGender: "female",
      },
      config: normalized,
    });
    let total = 0;
    let guard = 0;
    const sequence: StoryNodeId[] = [];
    while (!state.completed && guard < nodeIds.length + 2) {
      const node = nodes[state.currentNodeId];
      sequence.push(node.id);
      const duration = getNodeDuration(node, mode, normalized);
      total += duration;
      state = advanceStory(state, node.decision ? { decisionId: choice, elapsedSeconds: duration } : { elapsedSeconds: duration });
      guard += 1;
    }
    if (!state.completed) errors.push(`${mode} ${choice} route did not reach summary`);
    sequence.push(state.currentNodeId);
    return { total, sequence, state };
  };

  const routes = ["rescue_together", "signal_escape"].map((choiceId) => {
    const choice = choiceId as "rescue_together" | "signal_escape";
    const real = route(choice, "real");
    const demo = route(choice, "demo");
    const highIntensityIntervals = real.sequence.filter(
      (id) => nodes[id].isHighIntensityInterval,
    ).length;
    if (real.sequence.join("|") !== demo.sequence.join("|")) {
      errors.push(`${choice} uses different transitions in real and demo modes`);
    }
    if (highIntensityIntervals !== 3) {
      errors.push(`${choice} must contain exactly three high-intensity intervals`);
    }
    if (real.total < 8 * 60 || real.total > 12 * 60) {
      errors.push(`${choice} real route must last 8-12 minutes; received ${real.total} seconds`);
    }
    if (demo.total >= real.total) errors.push(`${choice} demo route must be faster than real mode`);
    return {
      choiceId,
      realNodeIds: real.sequence,
      demoNodeIds: demo.sequence,
      realSeconds: real.total,
      demoSeconds: demo.total,
      highIntensityIntervals,
    };
  });

  const reachable = new Set<StoryNodeId>();
  const pending: StoryNodeId[] = ["onboarding"];
  while (pending.length) {
    const id = pending.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes[id];
    const targets = [
      ...Object.values(node.transitions),
      ...(node.decision?.options.map((option) => option.nextNodeId) ?? []),
    ];
    for (const target of targets) if (!reachable.has(target)) pending.push(target);
  }
  for (const id of nodeIds) {
    if (!reachable.has(id)) errors.push(`${id} is unreachable from onboarding`);
  }

  return {
    valid: errors.length === 0,
    errors,
    realRouteSeconds: routes[0].realSeconds,
    demoRouteSeconds: routes[0].demoSeconds,
    warmupCalibrationSeconds,
    highIntensityNodeIds,
    routes,
  };
}

export { CLASSIFICATION_KEYS };
