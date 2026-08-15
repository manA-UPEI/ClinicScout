"use client";

import { useState } from "react";
import InputForm from "@/components/InputForm";
import AgentProgress from "@/components/AgentProgress";
import RecommendationView from "@/components/RecommendationView";
import SearchingState from "@/components/SearchingState";
import ErrorState from "@/components/ErrorState";
import type { AgentRunResult } from "@/lib/runAgent";
import { AgentErrorKind, InputFormData } from "@/lib/types";

type Phase = "input" | "searching" | "progress" | "recommendation" | "error";

interface ErrorInfo {
  kind: AgentErrorKind;
  message: string;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [location, setLocation] = useState("");

  async function handleSubmit(data: InputFormData) {
    setLocation(data.location);
    setPhase("searching");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = (await response.json()) as
        | AgentRunResult
        | { error: ErrorInfo };

      if ("error" in payload) {
        setError(payload.error);
        setPhase("error");
        return;
      }
      setResult(payload);
      setPhase("progress");
    } catch {
      setError({
        kind: "network",
        message: "Could not reach the server. Check your connection and try again.",
      });
      setPhase("error");
    }
  }

  function handleStartOver() {
    setResult(null);
    setError(null);
    setPhase("input");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center p-6">
      {phase === "input" && <InputForm onSubmit={handleSubmit} />}

      {phase === "searching" && <SearchingState location={location} />}

      {phase === "error" && error && (
        <ErrorState
          kind={error.kind}
          message={error.message}
          onRetry={handleStartOver}
        />
      )}

      {phase === "progress" && result && (
        <AgentProgress
          steps={result.steps}
          onComplete={() => setPhase("recommendation")}
        />
      )}

      {phase === "recommendation" && result && (
        <RecommendationView
          ranked={result.ranked}
          resolvedLocation={result.resolvedLocation}
          urgency={result.urgency}
          excluded={result.excluded}
          onStartOver={handleStartOver}
        />
      )}
    </main>
  );
}
