"use client";

import { useState } from "react";
import { AgentReasoning, ExcludedSpecialty, RankedClinic, Urgency } from "@/lib/types";
import ClinicCard from "./ClinicCard";
import ActionPanel from "./ActionPanel";
import EmergencyBanner from "./EmergencyBanner";

interface Props {
  ranked: RankedClinic[];
  resolvedLocation: string;
  urgency: Urgency;
  excluded: ExcludedSpecialty[];
  agentReasoning: AgentReasoning | null;
  onStartOver: () => void;
}

const ALTERNATIVES_SHOWN = 5;

/**
 * The agent's own reasoning, presented as reasoning and nothing more.
 *
 * Kept visually distinct from the clinic card above it on purpose: the card
 * shows verified facts, this shows an argument about them. Every field named
 * in `cited_fields` was checked as confirmed before this recommendation was
 * accepted (lib/agent/guards.ts), so the two can never contradict each other —
 * but the user should still be able to see which is which.
 */
function AgentRationale({ reasoning }: { reasoning: AgentReasoning }) {
  return (
    <div className="mt-3 rounded-xl border border-blue-500/25 bg-blue-500/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
        🤖 Agent&apos;s reasoning
        {reasoning.overrode_ranking && " — overrode the top-scored option"}
      </p>
      <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-200">
        {reasoning.reason}
      </p>
      {reasoning.cited_fields.length > 0 && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Based on confirmed:{" "}
          {reasoning.cited_fields.map((f) => f.replace(/_/g, " ")).join(", ")}
        </p>
      )}
    </div>
  );
}

export default function RecommendationView({
  ranked,
  resolvedLocation,
  urgency,
  excluded,
  agentReasoning,
  onStartOver,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const [best, ...alternatives] = ranked;
  const visible = showAll ? alternatives : alternatives.slice(0, ALTERNATIVES_SHOWN);

  return (
    <div className="flex flex-col gap-6 py-6">
      {urgency === "emergency_adjacent" && <EmergencyBanner />}

      <p className="text-sm text-gray-500 dark:text-gray-400">
        Results near {resolvedLocation}
      </p>

      <div>
        <ClinicCard clinic={best} variant="best" />
        {agentReasoning && <AgentRationale reasoning={agentReasoning} />}
        <ActionPanel clinic={best} />
      </div>

      {alternatives.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            Other options ({alternatives.length})
          </h2>
          {visible.map((c) => (
            <ClinicCard key={c.source_url} clinic={c} variant="alternative" />
          ))}
          {!showAll && alternatives.length > ALTERNATIVES_SHOWN && (
            <button
              onClick={() => setShowAll(true)}
              className="rounded-lg border border-black/15 dark:border-white/20 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10"
            >
              Show {alternatives.length - ALTERNATIVES_SHOWN} more
            </button>
          )}
        </div>
      )}

      {excluded.length > 0 && (
        <details className="rounded-xl border border-black/10 dark:border-white/15 p-4 text-sm">
          <summary className="cursor-pointer font-medium text-gray-600 dark:text-gray-300">
            {excluded.length} specialty {excluded.length === 1 ? "listing" : "listings"} set aside
          </summary>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            These are nearby, but they treat specific conditions rather than
            general walk-in complaints.
          </p>
          <ul className="mt-2 space-y-1">
            {excluded.map((e) => (
              <li key={e.clinic_name} className="text-gray-600 dark:text-gray-300">
                {e.clinic_name}
                <span className="text-gray-400 dark:text-gray-500">
                  {" "}— {e.specialty}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-col gap-3 border-t border-black/10 dark:border-white/15 pt-4">
        <button
          onClick={onStartOver}
          className="self-start text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Start a new search
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Clinic data from{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenStreetMap contributors
          </a>
          . Listings may be incomplete or out of date — always call ahead to
          confirm. Not medical advice; in an emergency call your local
          emergency number.
        </p>
      </div>
    </div>
  );
}
