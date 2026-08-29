export type CanonicalStoryChoice = "rescue_together" | "signal_escape";

export interface StoryContinuation {
  routeId: CanonicalStoryChoice;
  routeLabel: string;
  reply: string;
  source: "openai" | "gateway" | "fallback";
}
const SIGNAL_ROUTE_PATTERN =
  /\b(roof|rooftop|flare|signal|evac|evacuate|helicopter|radio|beacon|rescue team|higher ground|upstairs|stairwell)\b/i;

export function isCanonicalStoryChoice(value: unknown): value is CanonicalStoryChoice {
  return value === "rescue_together" || value === "signal_escape";
}

export function routeLabelFor(choice: CanonicalStoryChoice): string {
  return choice === "rescue_together" ? "Go back together" : "Light the flare";
}

/**
 * Keeps a spoken choice playable even when the story model is unavailable.
 * The runner's words never create new exercise demands: they only select one
 * of the two validated branches in the finite workout graph.
 */
export function fallbackStoryContinuation(
  choiceText: string,
  relationshipName: string,
): StoryContinuation {
  const routeId: CanonicalStoryChoice = SIGNAL_ROUTE_PATTERN.test(choiceText)
    ? "signal_escape"
    : "rescue_together";
  const safeName = relationshipName.trim().slice(0, 24) || "Alex";
  const reply = routeId === "signal_escape"
    ? `“I hear you,” ${safeName} says. “We’ll turn that move into a clear signal, then get out together.”`
    : `“I’m with you,” ${safeName} says. “We’ll use that move to reach each other without taking a reckless risk.”`;

  return {
    routeId,
    routeLabel: routeLabelFor(routeId),
    reply,
    source: "fallback",
  };
}
