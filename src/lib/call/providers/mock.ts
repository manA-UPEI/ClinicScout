import {
  buildScript,
  isIvr,
  isRefusal,
  isVoicemail,
  IVR_WITHDRAWAL,
  WITHDRAWAL,
} from "../script.ts";
import type { ScriptStepId } from "../script.ts";
import type { CallProvider } from "./index.ts";
import type { CallSession, CallStatus, CallTurn } from "../types.ts";

/**
 * A scripted receptionist on the other end of the line.
 *
 * This exists so the entire feature above the provider boundary — consent,
 * state machine, live transcript, verification, UI — can be built, tested and
 * demonstrated without dialing a real clinic. It is the same honesty the email
 * flow already practises by labelling itself "(Mock)".
 *
 * The personas are not decoration. Each one is a failure mode a real call hits
 * regularly, and each is a case the rest of the system has to handle without
 * inventing anything: an answering machine, a phone tree, a receptionist who
 * would rather not talk to a robot, and — the important one — a perfectly
 * friendly human who simply does not give a straight answer.
 */

/** Belt-and-braces against a persona edit that accidentally loops. */
const MAX_MOCK_CALL_MS = 40_000;

export type PersonaId =
  | "books_it"
  | "no_walk_ins"
  | "vague_answers"
  | "declines_ai"
  | "voicemail"
  | "ivr_maze"
  | "no_answer";

interface Persona {
  id: PersonaId;
  /** Spoken by the other end before the agent gets a word in. */
  greeting?: string;
  replies: Partial<Record<ScriptStepId, string>>;
  /** Nobody picks up at all. */
  unanswered?: boolean;
}

const PERSONAS: Record<PersonaId, Persona> = {
  books_it: {
    id: "books_it",
    greeting: "Good afternoon, clinic reception.",
    replies: {
      disclosure: "Oh — okay, sure. Go ahead.",
      identify: "Yes, you've reached us.",
      ask_walk_ins: "Yes, we're taking walk-ins today until six o'clock.",
      ask_wait: "Right now the wait is about 45 minutes.",
      ask_next_available:
        "Our next available appointment otherwise is Thursday at 2pm.",
      close: "No problem at all. Take care.",
    },
  },

  no_walk_ins: {
    id: "no_walk_ins",
    greeting: "Reception, how can I help?",
    replies: {
      disclosure: "Um, alright, I suppose so.",
      identify: "That's right, yes.",
      ask_walk_ins: "No, we're appointment only today, no walk-ins I'm afraid.",
      ask_wait: "There isn't really a wait, it's all pre-booked.",
      ask_next_available: "The next available slot is Thursday at 9am.",
      close: "You're welcome. Bye now.",
    },
  },

  // The one that matters most. Nothing this receptionist says is quotable as a
  // fact, and the honest result is a call that confirms nothing. A system that
  // returns "about 45 minutes" here is one that made it up.
  vague_answers: {
    id: "vague_answers",
    greeting: "Hello?",
    replies: {
      disclosure: "I guess so, yeah.",
      identify: "Mhm.",
      ask_walk_ins: "Uh, maybe? It sort of depends how the afternoon goes.",
      ask_wait: "Hard to say really, could be a while.",
      ask_next_available: "You'd have to check with the front desk on that one.",
      close: "Yep. Bye.",
    },
  },

  declines_ai: {
    id: "declines_ai",
    greeting: "Family practice, good morning.",
    replies: {
      disclosure: "Sorry — no, we don't take automated calls. Please have them ring us themselves.",
    },
  },

  voicemail: {
    id: "voicemail",
    greeting:
      "You've reached the clinic. We're unable to take your call right now. Please leave a message after the tone.",
    replies: {},
  },

  ivr_maze: {
    id: "ivr_maze",
    greeting:
      "Thank you for calling. For prescription refills, press 1. For appointments, press 2. To return to the main menu, press 9.",
    replies: {},
  },

  no_answer: { id: "no_answer", unanswered: true, replies: {} },
};

/** Deterministic per clinic, so the same listing behaves consistently across runs. */
function personaFor(clinicId: string): PersonaId {
  const ids = Object.keys(PERSONAS) as PersonaId[];
  let hash = 0;
  for (let i = 0; i < clinicId.length; i++) {
    hash = (hash * 31 + clinicId.charCodeAt(i)) >>> 0;
  }
  return ids[hash % ids.length];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export interface MockOptions {
  persona?: PersonaId;
  /** Zero in tests; realistic pacing in the app so the stream feels like a call. */
  agentPaceMs?: number;
  clinicPaceMs?: number;
  ringMs?: number;
}

export function createMockProvider(options: MockOptions = {}): CallProvider {
  const agentPace = options.agentPaceMs ?? 900;
  const clinicPace = options.clinicPaceMs ?? 1100;
  const ringMs = options.ringMs ?? 1500;

  return {
    name: "mock",

    async place(
      session: CallSession,
      onTurn: (turn: CallTurn) => void,
      signal: AbortSignal
    ): Promise<CallStatus> {
      const persona = PERSONAS[options.persona ?? personaFor(session.clinicId)];
      const startedAt = Date.now();
      const say = (speaker: "agent" | "clinic", text: string) =>
        onTurn({ speaker, text, atMs: Date.now() - startedAt });

      await sleep(ringMs, signal);
      if (signal.aborted) return "aborted";

      if (persona.unanswered) return "no_answer";

      if (persona.greeting) {
        say("clinic", persona.greeting);
        // Checked before the agent speaks: talking over an answering machine or
        // reading a script at a phone tree is exactly the tone-deaf automation
        // this feature should not produce.
        if (isVoicemail(persona.greeting)) return "voicemail";
        if (isIvr(persona.greeting)) {
          await sleep(agentPace, signal);
          say("agent", IVR_WITHDRAWAL);
          return "ivr_blocked";
        }
        await sleep(clinicPace, signal);
      }

      for (const line of buildScript(session.clinicName)) {
        if (signal.aborted) return "aborted";
        if (Date.now() - startedAt > MAX_MOCK_CALL_MS) return "failed";

        await sleep(agentPace, signal);
        if (signal.aborted) return "aborted";
        say("agent", line.text);

        const reply = persona.replies[line.id];
        if (reply === undefined) continue;

        await sleep(clinicPace, signal);
        if (signal.aborted) return "aborted";
        say("clinic", reply);

        if (isRefusal(reply)) {
          await sleep(agentPace, signal);
          say("agent", WITHDRAWAL);
          return "declined_ai";
        }
      }

      return "completed";
    },
  };
}

export const mockProvider = createMockProvider();
export { PERSONAS };
