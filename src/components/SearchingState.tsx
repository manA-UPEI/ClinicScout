"use client";

import { useEffect, useState } from "react";

// The whole search runs as one request/response — there's no server-sent
// progress during it — so a search that's legitimately retrying against a
// slow directory looks identical to one that's hung, unless this component
// says something once it's been a while.
const SLOW_THRESHOLD_MS = 12_000;

export default function SearchingState({ location }: { location: string }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-black/10 dark:border-white/15 p-10 text-center">
      <span className="inline-block animate-spin text-2xl motion-reduce:animate-none">⟳</span>
      <p className="font-medium animate-pulse motion-reduce:animate-none">
        Searching for clinics near {location}...
      </p>
      <p
        key={slow ? "slow" : "normal"}
        className="animate-fade-in text-sm text-gray-500 dark:text-gray-400"
      >
        {slow
          ? "Still working — the clinic directory can be slow to respond under load."
          : "Querying OpenStreetMap for real clinic listings. This can take a few seconds."}
      </p>
    </div>
  );
}
