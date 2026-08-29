import type {
  StoryEngineConfig,
  StoryNode,
  StoryNodeId,
  StoryNodeOverride,
} from "./types";

const AUTO_THRESHOLD = { strongSuccess: 0, success: 0, nearMiss: 0 } as const;
const MOVEMENT_THRESHOLD = { strongSuccess: 88, success: 72, nearMiss: 55 } as const;

const onward = (next: StoryNodeId) => ({
  strongSuccess: next,
  success: next,
  near: next,
  failure: next,
});

export const DEFAULT_STORY_CONFIG: StoryEngineConfig = {
  difficulty: 3,
  realDurationScale: 1,
  demoDurationScale: 1,
  thresholdOffset: 0,
};

export const BASE_STORY_NODES: Readonly<Record<StoryNodeId, StoryNode>> = {
  onboarding: {
    id: "onboarding",
    kind: "onboarding",
    title: "The broadcast",
    storyText:
      "{{runnerName}}, the emergency channel is still alive. {{relationshipName}}, your {{relationshipLabel}}, is waiting beyond the quarantine line. This run is about reaching them safely — never about ignoring pain or danger.",
    intendedDuration: { realSeconds: 30, demoSeconds: 6 },
    targetEffort: { rpe: 1, label: "setup", cue: "Stand somewhere safe and stay aware." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("permissions"),
    musicIntensity: 0.12,
    visualTheme: "signal_blackout",
  },
  permissions: {
    id: "permissions",
    kind: "permissions",
    title: "Open the channel",
    storyText:
      "Motion and audio can make the transmission react to you. You can continue without either permission; FableRun will never block the story or ask you to move unsafely.",
    intendedDuration: { realSeconds: 30, demoSeconds: 5 },
    targetEffort: { rpe: 1, label: "setup", cue: "Choose permissions without rushing." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("calibration"),
    musicIntensity: 0.16,
    visualTheme: "signal_blackout",
  },
  calibration: {
    id: "calibration",
    kind: "calibration",
    title: "Find your signal",
    storyText:
      "Move at a comfortable effort while the radio learns your baseline. Keep full control, watch your surroundings, and slow or stop whenever you need.",
    intendedDuration: { realSeconds: 30, demoSeconds: 7 },
    targetEffort: { rpe: 3, label: "easy", cue: "Comfortable, controlled movement." },
    successThreshold: { strongSuccess: 82, success: 65, nearMiss: 45 },
    transitions: onward("easy_start"),
    musicIntensity: 0.24,
    visualTheme: "safehouse",
  },
  briefing: {
    id: "briefing",
    kind: "briefing",
    title: "Route confirmed",
    storyText:
      "Three short pushes stand between you and {{relationshipName}}. Each one ends on a clear timer. Effort is optional: choose a safe pace, and stop if anything feels wrong.",
    intendedDuration: { realSeconds: 35, demoSeconds: 6 },
    targetEffort: { rpe: 2, label: "easy", cue: "Breathe and preview the route." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("sprint_one"),
    musicIntensity: 0.28,
    visualTheme: "evacuation_route",
  },
  easy_start: {
    id: "easy_start",
    kind: "easy",
    title: "Leave the safehouse",
    storyText:
      "The street is quiet. Settle into an easy rhythm, {{runnerName}}. The goal is control, not speed.",
    intendedDuration: { realSeconds: 60, demoSeconds: 10 },
    targetEffort: { rpe: 4, label: "steady", cue: "Easy, conversational effort." },
    successThreshold: { strongSuccess: 82, success: 64, nearMiss: 45 },
    transitions: onward("briefing"),
    musicIntensity: 0.38,
    visualTheme: "evacuation_route",
  },
  sprint_one: {
    id: "sprint_one",
    kind: "sprint",
    title: "Movement in the alley",
    storyText:
      "A shadow breaks from the fog. Increase effort only to a pace you can hold safely until the timer clears — then you recover.",
    intendedDuration: { realSeconds: 35, demoSeconds: 8 },
    targetEffort: { rpe: 8, label: "hard", cue: "Short, controlled push; never all-out." },
    successThreshold: MOVEMENT_THRESHOLD,
    transitions: onward("recovery_one"),
    musicIntensity: 0.76,
    visualTheme: "alley_pursuit",
    performanceResponses: {
      strong_success: "Clean break, {{runnerName}}. You gained ground before the gate dropped.",
      success: "You are through with room to breathe. The radio signal steadies.",
      near_miss:
        '"Still with you," {{relationshipName}} says. The gate bought enough time; ease down now.',
      miss:
        "You take cover instead of forcing the pace. Safe choice — the route remains open.",
    },
    isHighIntensityInterval: true,
  },
  recovery_one: {
    id: "recovery_one",
    kind: "recovery",
    title: "Gate sealed",
    storyText:
      "I can hear you, {{runnerName}}. The gate is sealed. Breathe. I am still here.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 60, demoSeconds: 8 },
    targetEffort: { rpe: 2, label: "recover", cue: "Slow down and regain control." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("sprint_two"),
    musicIntensity: 0.32,
    visualTheme: "breathing_room",
  },
  sprint_two: {
    id: "sprint_two",
    kind: "sprint",
    title: "Cross the floodlights",
    storyText:
      "The road ahead is exposed. Build to a strong but controlled effort. The safe line is close and the timer is finite.",
    intendedDuration: { realSeconds: 40, demoSeconds: 8 },
    targetEffort: { rpe: 8, label: "hard", cue: "Strong form, clear finish, no reckless acceleration." },
    successThreshold: MOVEMENT_THRESHOLD,
    transitions: onward("recovery_two"),
    musicIntensity: 0.84,
    visualTheme: "horde_pressure",
    performanceResponses: {
      strong_success:
        "You clear the floodlights before the horde turns. {{relationshipName}} marks a faster route.",
      success: "You reach the depot doors in control. The barricade holds behind you.",
      near_miss:
        'The doors catch at the last second. "You made it," {{relationshipName}} says. Recover fully.',
      miss:
        "You divert through a side entrance without chasing the clock. You are safe and still moving forward.",
    },
    isHighIntensityInterval: true,
  },
  recovery_two: {
    id: "recovery_two",
    kind: "recovery",
    title: "Inside the depot",
    storyText:
      "The office door is jammed, but I am safe for now. Take the recovery. I need you steady.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 60, demoSeconds: 8 },
    targetEffort: { rpe: 2, label: "recover", cue: "Easy movement or a complete stop." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("final_choice"),
    musicIntensity: 0.36,
    visualTheme: "breathing_room",
  },
  final_choice: {
    id: "final_choice",
    kind: "choice",
    title: "Choose the last route",
    storyText:
      "I have one flare. The roof is exposed. Come back through the service tunnel, or reach the flare and call evacuation. Your choice, {{runnerName}}.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 25, demoSeconds: 6 },
    targetEffort: { rpe: 1, label: "recover", cue: "Choose while fully under control." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("final_sprint_escape"),
    musicIntensity: 0.48,
    visualTheme: "crossroads",
    decision: {
      prompt: "Go back for {{relationshipName}}, or reach the evacuation flare?",
      options: [
        {
          id: "rescue_together",
          label: "Go back together",
          description: "Take the service tunnel to reach {{relationshipName}} before the doors seal.",
          nextNodeId: "final_sprint_rescue",
        },
        {
          id: "signal_escape",
          label: "Light the flare",
          description: "Reach the roof and secure an evacuation route for both of you.",
          nextNodeId: "final_sprint_escape",
        },
      ],
    },
  },
  final_sprint_rescue: {
    id: "final_sprint_rescue",
    kind: "sprint",
    title: "The service tunnel",
    storyText:
      "The release lever is behind the next door. I can hear you coming. One last controlled push, then we are out together.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 50, demoSeconds: 10 },
    targetEffort: { rpe: 9, label: "very_hard", cue: "Final timed push; slow immediately if needed." },
    successThreshold: { strongSuccess: 90, success: 75, nearMiss: 56 },
    transitions: {
      strongSuccess: "ending_rescue",
      success: "ending_rescue",
      near: "ending_survive",
      failure: "ending_survive",
    },
    musicIntensity: 1,
    visualTheme: "last_push",
    performanceResponses: {
      strong_success:
        "The lever snaps down and the lock releases. {{relationshipName}} is already moving toward you.",
      success: "The release turns just in time. You and {{relationshipName}} have a clear route out.",
      near_miss:
        "The main lock seals, so you guide {{relationshipName}} into a secure room and keep the radio connected.",
      miss:
        "You stop rather than force an unsafe push. {{relationshipName}} follows your voice to cover; both of you are secure.",
    },
    isHighIntensityInterval: true,
  },
  final_sprint_escape: {
    id: "final_sprint_escape",
    kind: "sprint",
    title: "The rooftop flare",
    storyText:
      "The stairwell shakes below you. One final controlled push reaches the roof. Keep your footing and finish at a pace that remains safe.",
    intendedDuration: { realSeconds: 50, demoSeconds: 10 },
    targetEffort: { rpe: 9, label: "very_hard", cue: "Final timed push; control matters more than speed." },
    successThreshold: { strongSuccess: 88, success: 72, nearMiss: 54 },
    transitions: {
      strongSuccess: "ending_escape",
      success: "ending_escape",
      near: "ending_survive",
      failure: "ending_survive",
    },
    musicIntensity: 1,
    visualTheme: "last_push",
    performanceResponses: {
      strong_success:
        "The flare catches high above the skyline. Evacuation answers immediately for you and {{relationshipName}}.",
      success: "The flare burns steadily. The rescue channel confirms your signal.",
      near_miss:
        "The first flare fails, but your radio beacon reaches the rescue channel. You take cover to wait.",
      miss:
        "You choose stable footing over the rooftop clock. From cover, you keep the rescue frequency alive.",
    },
    isHighIntensityInterval: true,
  },
  ending_rescue: {
    id: "ending_rescue",
    kind: "ending",
    title: "Together at the gate",
    storyText:
      "You came back. I knew you would. Now breathe, {{runnerName}}. We made it together.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 30, demoSeconds: 8 },
    targetEffort: { rpe: 2, label: "recover", cue: "Ease down now." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("cooldown"),
    musicIntensity: 0.46,
    visualTheme: "dawn",
  },
  ending_escape: {
    id: "ending_escape",
    kind: "ending",
    title: "Flare over the city",
    storyText:
      "I see the flare. Rescue has our signal. Stay on the roof, {{runnerName}}. I am coming to you.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 30, demoSeconds: 8 },
    targetEffort: { rpe: 2, label: "recover", cue: "Ease down now." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("cooldown"),
    musicIntensity: 0.46,
    visualTheme: "dawn",
  },
  ending_survive: {
    id: "ending_survive",
    kind: "ending",
    title: "The doors hold",
    storyText:
      "The doors are holding. I am safe. You did enough, {{runnerName}}. We wait for daylight.",
    speaker: "relationship",
    intendedDuration: { realSeconds: 30, demoSeconds: 8 },
    targetEffort: { rpe: 2, label: "recover", cue: "Ease down now." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("cooldown"),
    musicIntensity: 0.34,
    visualTheme: "aftermath",
  },
  cooldown: {
    id: "cooldown",
    kind: "cooldown",
    title: "The city goes quiet",
    storyText:
      "Walk slowly or rest. Let your breathing return toward normal. The danger is past; there is no score to chase here.",
    intendedDuration: { realSeconds: 90, demoSeconds: 12 },
    targetEffort: { rpe: 1, label: "recover", cue: "Gentle cooldown or complete rest." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("summary"),
    musicIntensity: 0.16,
    visualTheme: "aftermath",
  },
  summary: {
    id: "summary",
    kind: "summary",
    title: "Run complete",
    storyText:
      "Transmission saved. {{runnerName}} and {{relationshipName}} will carry this chapter into the next run.",
    intendedDuration: { realSeconds: 60, demoSeconds: 8 },
    targetEffort: { rpe: 1, label: "recover", cue: "Hydrate and recover." },
    successThreshold: AUTO_THRESHOLD,
    transitions: onward("summary"),
    musicIntensity: 0.08,
    visualTheme: "aftermath",
    isTerminal: true,
  },
};

function mergeNode(node: StoryNode, override?: StoryNodeOverride): StoryNode {
  if (!override) return node;

  return {
    ...node,
    ...override,
    id: node.id,
    intendedDuration: { ...node.intendedDuration, ...override.intendedDuration },
    successThreshold: { ...node.successThreshold, ...override.successThreshold },
    transitions: { ...node.transitions, ...override.transitions },
    targetEffort: { ...node.targetEffort, ...override.targetEffort },
  };
}

export function createStoryNodes(
  config: StoryEngineConfig = DEFAULT_STORY_CONFIG,
): Readonly<Record<StoryNodeId, StoryNode>> {
  const entries = (Object.keys(BASE_STORY_NODES) as StoryNodeId[]).map((id) => [
    id,
    mergeNode(BASE_STORY_NODES[id], config.nodeOverrides?.[id]),
  ]);

  return Object.fromEntries(entries) as Record<StoryNodeId, StoryNode>;
}
