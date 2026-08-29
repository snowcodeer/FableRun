import {
  advanceStory,
  createInitialRunState,
  getNode,
  getNodeDuration,
  renderDecision,
  renderStoryText,
  scoreInterval,
  summarizeRun,
  type IntervalPerformance,
  type PerformanceClassification,
  type RunState,
  type RunnerProfile,
  type StoryNode,
  type StoryNodeId,
} from "@/lib/story";

export type DifficultyChoice = "beginner" | "regular" | "intense";
export type DemoIntervalResult = "strong" | "success" | "near" | "miss";
export type RunInstruction = "RUN" | "PUSH" | "SPRINT" | "RECOVER" | "DECIDE";

export interface StorySceneModel {
  id: StoryNodeId;
  instruction: RunInstruction;
  label: string;
  durationSeconds: number;
  story: string;
  cue: string;
  musicIntensity: number;
  intervalNumber: number;
  totalMovementScenes: number;
  isHighIntensity: boolean;
}

export interface PerformanceSample {
  baselineSpeedMps: number;
  distanceMeters: number;
  durationSeconds: number;
  speedMps: number;
  stops?: number;
  consistency?: number;
}

const DIFFICULTY_LEVEL: Record<DifficultyChoice, number> = {
  beginner: 2,
  regular: 3,
  intense: 4,
};

const MOVEMENT_SEQUENCE: StoryNodeId[] = [
  "easy_start",
  "sprint_one",
  "recovery_one",
  "sprint_two",
  "recovery_two",
  "final_choice",
  "final_sprint_rescue",
  "final_sprint_escape",
  "cooldown",
];

const INSTRUCTION_BY_KIND: Record<StoryNode["kind"], RunInstruction> = {
  onboarding: "DECIDE",
  permissions: "DECIDE",
  calibration: "RUN",
  briefing: "DECIDE",
  easy: "RUN",
  sprint: "SPRINT",
  recovery: "RECOVER",
  choice: "DECIDE",
  ending: "RECOVER",
  cooldown: "RECOVER",
  summary: "RECOVER",
};

const RESULT_CLASSIFICATION: Record<DemoIntervalResult, PerformanceClassification> = {
  strong: "strong_success",
  success: "success",
  near: "near_miss",
  miss: "miss",
};

export function runnerProfileFromForm(input: {
  savee: string;
  relationship: string;
}): RunnerProfile {
  return {
    runnerName: "Runner",
    relationshipName: input.savee.trim() || "Alex",
    relationshipLabel: input.relationship.trim().toLowerCase() || "friend",
  };
}

export function createReadyRunState(options: {
  profile: RunnerProfile;
  difficulty: DifficultyChoice;
  demoMode: boolean;
}): RunState {
  let state = createInitialRunState({
    mode: options.demoMode ? "demo" : "real",
    profile: options.profile,
    config: {
      difficulty: DIFFICULTY_LEVEL[options.difficulty],
      thresholdOffset:
        options.difficulty === "beginner" ? -4 : options.difficulty === "intense" ? 4 : 0,
    },
  });

  // The product UI owns the briefing screen. Advance the engine through the
  // setup nodes so the first timed scene begins at the easy warm-up.
  for (const expected of ["onboarding", "permissions", "calibration"] as const) {
    if (state.currentNodeId !== expected) {
      throw new Error(`Story setup expected ${expected}, received ${state.currentNodeId}.`);
    }
    state = advanceStory(state);
  }

  return state;
}

export function getCurrentScene(state: RunState): StorySceneModel {
  const node = getNode(state.currentNodeId, state.config);
  const sequenceIndex = MOVEMENT_SEQUENCE.indexOf(node.id);
  const completedMovement = state.history.filter((entry) =>
    MOVEMENT_SEQUENCE.includes(entry.nodeId),
  ).length;

  return {
    id: node.id,
    instruction: INSTRUCTION_BY_KIND[node.kind],
    label: node.title,
    durationSeconds: getNodeDuration(node, state.mode, state.config),
    story: renderStoryText(node, state.profile),
    cue: node.targetEffort.cue,
    musicIntensity: node.musicIntensity,
    intervalNumber: sequenceIndex >= 0 ? completedMovement + 1 : completedMovement,
    totalMovementScenes: 8,
    isHighIntensity: node.isHighIntensityInterval === true,
  };
}

export function livePerformance(
  state: RunState,
  sample: PerformanceSample,
): IntervalPerformance {
  const durationSeconds = Math.max(1, sample.durationSeconds);
  const baselineSpeed = Math.max(0.6, sample.baselineSpeedMps);
  const actualSpeed = sample.distanceMeters > 0
    ? sample.distanceMeters / durationSeconds
    : Math.max(0, sample.speedMps);
  const targetDistance = baselineSpeed * durationSeconds * 1.12;

  return {
    baseline: {
      distanceMeters: baselineSpeed * 60,
      targetTimeSeconds: 60,
      stops: 0,
      consistency: 0.75,
    },
    difficulty: state.config.difficulty,
    improvementPercent: ((actualSpeed / baselineSpeed) - 1) * 100,
    targetTimePercentage: 100,
    distanceMeters: Math.max(0, sample.distanceMeters),
    targetDistanceMeters: Math.max(1, targetDistance),
    stops: Math.max(0, sample.stops ?? (actualSpeed < 0.2 ? 1 : 0)),
    consistency: Math.max(0, Math.min(1, sample.consistency ?? (actualSpeed > 0.2 ? 0.76 : 0.35))),
  };
}

export function demoPerformance(
  state: RunState,
  result: DemoIntervalResult,
): IntervalPerformance {
  const presets: Record<DemoIntervalResult, Omit<IntervalPerformance, "baseline" | "difficulty">> = {
    strong: {
      improvementPercent: 35,
      targetTimePercentage: 80,
      distanceMeters: 260,
      targetDistanceMeters: 200,
      stops: 0,
      consistency: 1,
    },
    success: {
      improvementPercent: 0,
      targetTimePercentage: 110,
      distanceMeters: 170,
      targetDistanceMeters: 200,
      stops: 1,
      consistency: 0.7,
    },
    near: {
      improvementPercent: -8,
      targetTimePercentage: 120,
      distanceMeters: 135,
      targetDistanceMeters: 200,
      stops: 1,
      consistency: 0.58,
    },
    miss: {
      improvementPercent: -20,
      targetTimePercentage: 145,
      distanceMeters: 70,
      targetDistanceMeters: 200,
      stops: 3,
      consistency: 0.28,
    },
  };

  const performance: IntervalPerformance = {
    ...presets[result],
    baseline: {
      distanceMeters: 150,
      targetTimeSeconds: 60,
      stops: 0,
      consistency: 0.75,
    },
    difficulty: state.config.difficulty,
  };

  const node = getNode(state.currentNodeId, state.config);
  const classified = scoreInterval(
    performance,
    node.successThreshold,
    state.config.thresholdOffset,
  ).classification;
  const expected = RESULT_CLASSIFICATION[result];
  if (classified !== expected) {
    throw new Error(`Demo preset ${result} classified as ${classified}, expected ${expected}.`);
  }

  return performance;
}

export function advanceRun(options: {
  state: RunState;
  result: DemoIntervalResult;
  performance?: IntervalPerformance;
  elapsedSeconds?: number;
}): RunState {
  const node = getNode(options.state.currentNodeId, options.state.config);
  if (node.decision) return options.state;

  const performance = node.isHighIntensityInterval
    ? options.performance ?? demoPerformance(options.state, options.result)
    : undefined;

  let nextState = advanceStory(options.state, {
    performance,
    elapsedSeconds: options.elapsedSeconds,
  });

  // `briefing` remains in the canonical graph (and therefore in duration and
  // history accounting), but it has already been shown by the product UI.
  // Consume it here instead of interrupting the timed run with a duplicate.
  if (nextState.currentNodeId === "briefing") {
    nextState = advanceStory(nextState);
  }

  return nextState;
}

export function chooseRoute(state: RunState, decisionId: string): RunState {
  return advanceStory(state, { decisionId });
}

export function getDecisionModel(state: RunState) {
  const node = getNode(state.currentNodeId, state.config);
  return renderDecision(node, state.profile);
}

export function getEndingModel(state: RunState) {
  const node = getNode(state.currentNodeId, state.config);
  return {
    title: node.title,
    story: renderStoryText(node, state.profile),
    outcome: summarizeRun(state).outcome,
  };
}

export function getSummaryModel(state: RunState) {
  return summarizeRun(state);
}

export function narrationPrefetchLines(state: RunState): string[] {
  const node = getNode(state.currentNodeId, state.config);
  const nextIds = new Set<StoryNodeId>([
    node.transitions.strongSuccess,
    node.transitions.success,
    node.transitions.near,
    node.transitions.failure,
    ...(node.decision?.options.map((option) => option.nextNodeId) ?? []),
  ]);

  return [
    renderStoryText(node, state.profile),
    ...Array.from(nextIds, (id) => renderStoryText(getNode(id, state.config), state.profile)),
  ].filter((line, index, lines) => line.length > 0 && lines.indexOf(line) === index);
}

export function threatDistanceFor(state: RunState): number {
  const gains = state.classifications.strong_success * 22 + state.classifications.success * 12;
  const losses = state.classifications.near_miss * 16 + state.classifications.miss * 30;
  return Math.max(18, Math.min(180, Math.round(112 + gains - losses)));
}

export function latestPerformanceResponse(state: RunState): string {
  const latest = state.history.at(-1);
  return latest?.performanceResponse ?? "Signal steady · story route ready";
}

export function paceLabel(paceSecondsPerKm: number | null): string {
  if (!paceSecondsPerKm || !Number.isFinite(paceSecondsPerKm)) return "--:--";
  const rounded = Math.max(0, Math.round(paceSecondsPerKm));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
