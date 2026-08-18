"use client";

import { useState } from "react";
import InputForm from "@/components/InputForm";
import AgentProgress from "@/components/AgentProgress";
import RecommendationView from "@/components/RecommendationView";
import SearchingState from "@/components/SearchingState";
import ErrorState from "@/components/ErrorState";
import { readSseStream } from "@/lib/sseClient";
import type { AgentRunResult, AgentStep, InputFormData } from "@/domain/entities/agentRun";
import type { AgentErrorKind } from "@/domain/entities/errors";

type Phase = "input" | "searching" | "progress" | "recommendation" | "error";

interface ErrorInfo {
  kind: AgentErrorKind;
  message: string;
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [location, setLocation] = useState("");

  async function handleSubmit(data: InputFormData) {
    setLocation(data.location);
    setSteps([]);
    setResult(null);
    setPhase("searching");

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      // Input validation still answers with plain JSON — there is nothing to
      // stream when the request never starts a run.
      if (!response.body || !response.headers.get("Content-Type")?.includes("event-stream")) {
        const payload = (await response.json().catch(() => null)) as
          | { error: ErrorInfo }
          | null;
        setError(
          payload?.error ?? {
            kind: "network",
            message: "The server returned an unexpected response.",
          }
        );
        setPhase("error");
        return;
      }

      for await (const event of readSseStream(response.body)) {
        if (event.event === "step") {
          setSteps((prev) => [...prev, event.data as AgentStep]);
          setPhase("progress");
        } else if (event.event === "result") {
          setResult(event.data as AgentRunResult);
        } else if (event.event === "error") {
          setError(event.data as ErrorInfo);
          setPhase("error");
          return;
        }
      }
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
