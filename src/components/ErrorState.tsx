import { AgentErrorKind } from "@/domain/entities/errors";

interface Props {
  kind: AgentErrorKind;
  message: string;
  onRetry: () => void;
}

const HEADINGS: Record<AgentErrorKind, string> = {
  location_not_found: "We couldn't find that location",
  no_results: "No clinics found nearby",
  network: "Something went wrong",
};

export default function ErrorState({ kind, message, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-8 text-center">
      <h2 className="font-semibold">{HEADINGS[kind]}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
      <button
        onClick={onRetry}
        className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Try another search
      </button>
    </div>
  );
}
