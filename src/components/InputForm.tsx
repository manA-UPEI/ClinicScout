"use client";

import { FormEvent, useState } from "react";
import { InputFormData, Urgency } from "@/domain/entities/agentRun";

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
        <h1 className="text-2xl font-bold">ClinicScout AI</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Find the best nearby walk-in clinic, right now. Searches real clinic
          listings from OpenStreetMap.
        </p>
      </div>

      <label className="flex flex-col gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        Location
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Charlottetown, PEI"
          required
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-base font-medium text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        Urgency
        <select
          value={urgency}
          onChange={(e) => setUrgency(e.target.value as Urgency)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-base font-medium text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="routine">Routine</option>
          <option value="urgent">Urgent</option>
          <option value="emergency_adjacent">Emergency-adjacent</option>
        </select>
      </label>

      <label className="flex flex-col gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        Max radius (km)
        <input
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          value={maxRadiusKm}
          onChange={(e) => setMaxRadiusKm(Number(e.target.value))}
          required
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-base font-medium text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none focus:ring-2 focus:ring-blue-500"
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
