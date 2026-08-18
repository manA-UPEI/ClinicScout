"use client";

import { useState } from "react";
import InputForm from "@/components/InputForm";
import AgentProgress from "@/components/AgentProgress";
import RecommendationView from "@/components/RecommendationView";
import SearchingState from "@/components/SearchingState";
import ErrorState from "@/components/ErrorState";
import { useStreamedSse } from "@/components/hooks/useStreamedSse";
import type { AgentRunResult, AgentStep, InputFormData } from "@/domain/entities/agentRun";
import type { AgentErrorKind } from "@/domain/entities/errors";

type Phase = "input" | "searching" | "progress" | "recommendation" | "error";

interface ErrorInfo {
  kind: AgentErrorKind;
  message: string;
  requestId?: string;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [location, setLocation] = useState("");
  const { run } = useStreamedSse();

  async function handleSubmit(data: InputFormData) {
    setLocation(data.location);
    setSteps([]);
    setResult(null);
    setPhase("searching");

    await run("/api/search", data, {
      fallbackErrorMessage: "The server returned an unexpected response.",
      networkErrorMessage: "Could not reach the server. Check your connection and try again.",
      onEvent: (event) => {
        if (event.event === "step") {
          setSteps((prev) => [...prev, event.data as AgentStep]);
          setPhase("progress");
        } else if (event.event === "result") {
          setResult(event.data as AgentRunResult);
        } else if (event.event === "error") {
          setError(event.data as ErrorInfo);
          setPhase("error");
        }
      },
      onError: (error) => {
        setError({
          kind: (error.kind as AgentErrorKind) ?? "network",
          message: error.message,
          requestId: error.requestId,
        });
        setPhase("error");
      },
    });
  }

  function handleStartOver() {
    setResult(null);
    setError(null);
    setSteps([]);
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
          requestId={error.requestId}
          onRetry={handleStartOver}
        />
      )}

      {phase === "progress" && (
        <AgentProgress
          steps={steps}
          done={result !== null}
          onComplete={() => setPhase("recommendation")}
        />
      )}

      {phase === "recommendation" && result && (
        <RecommendationView
          ranked={result.ranked}
          resolvedLocation={result.resolvedLocation}
          urgency={result.urgency}
          excluded={result.excluded}
          agentReasoning={result.agentReasoning}
          onStartOver={handleStartOver}
        />
      )}
    </main>
  );
}
