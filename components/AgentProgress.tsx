"use client";

import { useEffect, useState } from "react";
import { AgentStep } from "@/lib/types";

interface Props {
  steps: AgentStep[];
  onComplete: () => void;
}

// A dense city can return dozens of clinics, so pace the reveal to a fixed
// total budget instead of a fixed per-step delay — otherwise the transparency
// animation would keep a sick user waiting far longer than the search itself.
const TOTAL_BUDGET_MS = 2400;
const MAX_STEP_DELAY_MS = 500;

export default function AgentProgress({ steps, onComplete }: Props) {
  const [revealedCount, setRevealedCount] = useState(0);
  const stepDelay = Math.min(
    MAX_STEP_DELAY_MS,
    Math.max(40, Math.round(TOTAL_BUDGET_MS / Math.max(steps.length, 1)))
  );

  useEffect(() => {
    if (revealedCount >= steps.length) {
      const t = setTimeout(onComplete, stepDelay);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRevealedCount((n) => n + 1), stepDelay);
    return () => clearTimeout(t);
  }, [revealedCount, steps.length, onComplete, stepDelay]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 dark:border-white/15 p-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
        Agent is working...
      </h2>
      <ul className="flex flex-col gap-2">
        {steps.slice(0, revealedCount).map((step, i) => {
          const isLast = i === revealedCount - 1;
          const isDone = i < revealedCount - 1 || revealedCount >= steps.length;
          return (
            <li key={step.id} className="flex items-center gap-2 text-sm">
              <span className="w-4 shrink-0 text-center">
                {isDone || !isLast ? (
                  "✓"
                ) : (
                  <span className="inline-block animate-spin">⟳</span>
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
