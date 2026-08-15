"use client";

import { FormEvent, useState } from "react";
import { InputFormData, Urgency } from "@/lib/types";

interface Props {
  onSubmit: (data: InputFormData) => void;
}

export default function InputForm({ onSubmit }: Props) {
  const [location, setLocation] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("urgent");
  const [maxRadiusKm, setMaxRadiusKm] = useState(5);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ location, urgency, maxRadiusKm });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-black/10 dark:border-white/15 p-6"
    >
      <div>
        <h1 className="text-xl font-semibold">ClinicScout AI</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Find the best nearby walk-in clinic, right now. Searches real clinic
          listings from OpenStreetMap.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Location
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Charlottetown, PEI"
          required
          className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Urgency
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as Urgency)}
          className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="emergency_adjacent">Emergency-adjacent</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Max radius (km)
        <input
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          value={maxRadiusKm}
          onChange={(e) => setMaxRadiusKm(Number(e.target.value))}
          required
          className="rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <button
        type="submit"
        className="mt-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        Find a clinic
      </button>
    </form>
  );
}
