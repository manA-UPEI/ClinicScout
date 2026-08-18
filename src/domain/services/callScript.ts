/**
 * What the agent is allowed to say.
 *
 * The agent does not compose its own dialogue. It reads a fixed sequence of
 * lines with exactly one slot — the clinic's name — and that constraint is the
 * whole privacy story: there is no slot capable of carrying a symptom, a
 * diagnosis, a name, or a callback number, so none can leak by accident or by
 * a badly-worded prompt. `Urgency` is deliberately not a parameter here; it
 * shapes the ranking, never the conversation.
 *
 * The disclosure is a constant and is always index 0. Announcing that the
 * caller is automated is not a nicety — an undisclosed synthetic voice on an
 * outbound call is the thing regulators specifically prohibit, and a clinic
 * receptionist deserves to know who they are talking to regardless.
 */

export type ScriptStepId =
  | "disclosure"
  | "identify"
  | "ask_walk_ins"
  | "ask_wait"
  | "ask_next_available"
  | "close";

export interface ScriptLine {
  id: ScriptStepId;
  text: string;
}

/**
 * Spoken first, every time, before anything is asked. Never model-generated
 * and never skippable — `buildScript` puts it at index 0 and the provider
 * contract is to deliver it before any question.
 */
export const DISCLOSURE =
  "Hello — I'm an automated assistant calling on behalf of a patient. " +
  "I'm an AI, not a person, and this call is being transcribed. " +
  "Is it alright if I ask a couple of quick questions about walk-in availability?";

/**
 * Said when the answerer would rather not deal with an automated caller, then
 * the agent hangs up. Not a retry, not a negotiation: a refusal is final.
 */
export const WITHDRAWAL =
  "Understood — I'll have the patient call you directly instead. " +
  "Sorry to have bothered you, and thank you for your time.";

/** Said if the agent reaches an automated menu rather than a person. */
export const IVR_WITHDRAWAL =
  "This appears to be an automated menu, so I'll end the call here.";

/**
 * The full script for one call. Takes the clinic name and nothing else — the
 * single-parameter signature is asserted in the call-script suite, so a later
 * change that threads patient detail through here fails the suite rather than
 * quietly shipping.
 */
export function buildScript(clinicName: string): ScriptLine[] {
  const name = clinicName.trim() || "this clinic";
  return [
    { id: "disclosure", text: DISCLOSURE },
    { id: "identify", text: `Am I through to ${name}?` },
    {
      id: "ask_walk_ins",
      text: "Are you accepting walk-in patients today?",
    },
    {
      id: "ask_wait",
      text: "Roughly how long is the wait at the moment?",
    },
    {
      id: "ask_next_available",
      text: "And if not today, when is the next available time?",
    },
    {
      id: "close",
      text: "That's everything I needed — thank you very much for your help.",
    },
  ];
}

/**
 * Phrases that mean "don't talk to me, you're a robot". Matched against the
 * answerer's words so the agent withdraws instead of pressing on, which is
 * both the courteous behaviour and the legally safe one.
 */
const REFUSAL_PATTERNS: RegExp[] = [
  /\b(no|not)\b.{0,20}\b(ai|robots?|bots?|automated|machines?|recordings?)\b/i,
  /\b(we|i)\s+(don'?t|do not|won'?t|will not)\b.{0,30}\b(ai|robots?|bots?|automated|recorded)\b/i,
  /\bhuman\s+(only|being)\b/i,
  /\bhang(ing)?\s+up\b/i,
  /\bstop\s+calling\b/i,
];

export function isRefusal(utterance: string): boolean {
  return REFUSAL_PATTERNS.some((p) => p.test(utterance));
}

/**
 * Phrases that mean we reached a phone tree rather than a person. Pressing
 * digits at a clinic's menu is exactly the kind of blind automation this
 * feature should not do, so the agent withdraws instead.
 */
const IVR_PATTERNS: RegExp[] = [
  /\bpress\s+(one|two|three|four|[1-9])\b/i,
  /\bmain\s+menu\b/i,
  /\bfor\s+(english|french|prescription refills?|billing)\b.{0,20}\bpress\b/i,
];

export function isIvr(utterance: string): boolean {
  return IVR_PATTERNS.some((p) => p.test(utterance));
}

/** Phrases that mean we reached an answering machine. */
const VOICEMAIL_PATTERNS: RegExp[] = [
  /\bleave a (message|voicemail)\b/i,
  /\bafter the (tone|beep)\b/i,
  /\bunable to (take|answer) your call\b/i,
];

export function isVoicemail(utterance: string): boolean {
  return VOICEMAIL_PATTERNS.some((p) => p.test(utterance));
}
