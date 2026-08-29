export type RunMode = "real" | "demo";
export type CharacterGender = "female" | "male";
export type StorySpeaker = "narrator" | "relationship";

export type StoryNodeId =
  | "onboarding"
  | "permissions"
  | "calibration"
  | "briefing"
  | "easy_start"
  | "sprint_one"
  | "recovery_one"
  | "sprint_two"
  | "recovery_two"
  | "final_choice"
  | "final_sprint_rescue"
  | "final_sprint_escape"
  | "ending_rescue"
  | "ending_escape"
  | "ending_survive"
  | "cooldown"
  | "summary";

export type StoryNodeKind =
  | "onboarding"
  | "permissions"
  | "calibration"
  | "briefing"
  | "easy"
  | "sprint"
  | "recovery"
  | "choice"
  | "ending"
  | "cooldown"
  | "summary";

export type PerformanceClassification =
  | "strong_success"
  | "success"
  | "near_miss"
  | "miss";

export type VisualTheme =
  | "signal_blackout"
  | "safehouse"
  | "evacuation_route"
  | "alley_pursuit"
  | "breathing_room"
  | "horde_pressure"
  | "crossroads"
  | "last_push"
  | "dawn"
  | "aftermath";

export interface IntendedDuration {
  realSeconds: number;
  demoSeconds: number;
}

export interface TargetEffort {
  /** Perceived exertion on a 1-10 scale. */
  rpe: number;
  label: "setup" | "easy" | "steady" | "hard" | "very_hard" | "recover";
  cue: string;
}

export interface SuccessThresholds {
  strongSuccess: number;
  success: number;
  nearMiss: number;
}

export interface StoryTransitions {
  strongSuccess: StoryNodeId;
  success: StoryNodeId;
  near: StoryNodeId;
  failure: StoryNodeId;
}

export interface StoryDecisionOption {
  id: string;
  label: string;
  description: string;
  nextNodeId: StoryNodeId;
}

export interface StoryDecision {
  prompt: string;
  options: readonly StoryDecisionOption[];
}

export interface StoryNode {
  id: StoryNodeId;
  kind: StoryNodeKind;
  title: string;
  /** Supports {{runnerName}}, {{relationshipName}}, and {{relationshipLabel}}. */
  storyText: string;
  /** Selects the narrator or the personalised character cast voice. */
  speaker?: StorySpeaker;
  intendedDuration: IntendedDuration;
  targetEffort: TargetEffort;
  successThreshold: SuccessThresholds;
  transitions: StoryTransitions;
  musicIntensity: number;
  visualTheme: VisualTheme;
  decision?: StoryDecision;
  /** Short narrative feedback shown after a measured effort. */
  performanceResponses?: Readonly<Record<PerformanceClassification, string>>;
  isHighIntensityInterval?: boolean;
  isTerminal?: boolean;
}

export interface RunnerProfile {
  runnerName: string;
  relationshipName: string;
  relationshipLabel: string;
  relationshipGender: CharacterGender;
}

export interface PerformanceBaseline {
  distanceMeters: number;
  targetTimeSeconds: number;
  stops: number;
  consistency: number;
}

export interface IntervalPerformance {
  baseline: PerformanceBaseline;
  /** Difficulty from 1 (gentle) to 5 (most demanding). */
  difficulty?: number;
  /** Change from the runner's baseline, as a percentage. */
  improvementPercent: number;
  /** Actual interval time divided by target time, as a percentage. */
  targetTimePercentage: number;
  distanceMeters: number;
  targetDistanceMeters: number;
  stops: number;
  /** Pace steadiness from 0 to 1. */
  consistency: number;
}

export interface ScoreBreakdown {
  baselineRelative: number;
  improvement: number;
  targetTime: number;
  distance: number;
  stops: number;
  consistency: number;
  difficultyAdjustment: number;
}

export interface IntervalScore {
  score: number;
  classification: PerformanceClassification;
  breakdown: ScoreBreakdown;
}

export interface StoryNodeOverride
  extends Partial<
    Omit<
      StoryNode,
      "id" | "intendedDuration" | "successThreshold" | "transitions" | "targetEffort"
    >
  > {
  intendedDuration?: Partial<IntendedDuration>;
  successThreshold?: Partial<SuccessThresholds>;
  transitions?: Partial<StoryTransitions>;
  targetEffort?: Partial<TargetEffort>;
}

export interface StoryEngineConfig {
  difficulty: number;
  realDurationScale: number;
  demoDurationScale: number;
  thresholdOffset: number;
  nodeOverrides?: Partial<Record<StoryNodeId, StoryNodeOverride>>;
}

export interface StoryHistoryEntry {
  nodeId: StoryNodeId;
  nextNodeId: StoryNodeId;
  classification: PerformanceClassification;
  score: number | null;
  performanceResponse: string | null;
  decisionId?: string;
  elapsedSeconds: number;
}

export interface RunState {
  mode: RunMode;
  profile: RunnerProfile;
  config: StoryEngineConfig;
  currentNodeId: StoryNodeId;
  elapsedSeconds: number;
  scores: readonly number[];
  totalDistanceMeters: number;
  totalStops: number;
  classifications: Readonly<Record<PerformanceClassification, number>>;
  decisions: Readonly<Record<string, string>>;
  history: readonly StoryHistoryEntry[];
  completed: boolean;
}

export interface AdvanceStoryInput {
  performance?: IntervalPerformance;
  decisionId?: string;
  /** Override the node's intended duration when the UI has measured real elapsed time. */
  elapsedSeconds?: number;
}

export interface RunSummary {
  outcome: "rescued_together" | "escaped_to_safety" | "survived_the_night" | "in_progress";
  outcomeTitle: string;
  outcomeText: string;
  averageScore: number | null;
  bestScore: number | null;
  completedIntervals: number;
  totalDistanceMeters: number;
  totalStops: number;
  elapsedSeconds: number;
  decisions: Readonly<Record<string, string>>;
  encouragement: string;
}

export interface StoryRouteValidation {
  choiceId: string;
  realNodeIds: readonly StoryNodeId[];
  demoNodeIds: readonly StoryNodeId[];
  realSeconds: number;
  demoSeconds: number;
  highIntensityIntervals: number;
}

export interface StoryGraphValidation {
  valid: boolean;
  errors: readonly string[];
  realRouteSeconds: number;
  demoRouteSeconds: number;
  warmupCalibrationSeconds: number;
  highIntensityNodeIds: readonly StoryNodeId[];
  routes: readonly StoryRouteValidation[];
}
