"use client";

import { useEffect } from "react";
import { AgentStep } from "@/lib/types";

interface Props {
  steps: AgentStep[];
  /** True once the run's final result has arrived. */
  done: boolean;
  onComplete: () => void;
}

// Just long enough for the closing step to register as having happened, rather
// than the log vanishing the instant the last line lands.
const SETTLE_MS = 600;

/**
 * A live log of what the agent is doing, rendered as steps stream in.
 *
 * This used to animate an already-finished array on a fixed time budget,
 * because the whole run completed before the client heard anything. The run now
 * streams, so the pacing is the agent's own — an inspection that takes four
 * seconds looks like four seconds, which is the honest picture and the reason
 * the transparency log exists.
 */
export default function AgentProgress({ steps, done, onComplete }: Props) {
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onComplete, SETTLE_MS);
    return () => clearTimeout(t);
  }, [done, onComplete]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 dark:border-white/15 p-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
        {done ? "Agent finished" : "Agent is working..."}
      </h2>
      <ul className="flex flex-col gap-2">
        {steps.map((step, i) => {
          const isCurrent = !done && i === steps.length - 1;
          return (
            <li key={`${step.id}-${i}`} className="flex items-start gap-2 text-sm">
              <span className="w-4 shrink-0 text-center leading-5">
                {isCurrent ? (
                  <span className="inline-block animate-spin">⟳</span>
                ) : (
                  "✓"
                )}
              </span>
              <span>{step.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
