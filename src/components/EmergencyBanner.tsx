import { emergencyNumberFor } from "@/domain/policies/emergencyNumber";

interface Props {
  /** The resolved search location's country, so the headline names a real number instead of assuming North America. */
  countryCode: string | null;
}

/**
 * Shown whenever the user flags their situation as emergency-adjacent. A clinic
 * recommendation is the wrong answer for a possible emergency, so this sits
 * above the results rather than beside them.
 *
 * The headline never states a number it isn't confident about — see
 * domain/policies/emergencyNumber.ts. An unrecognised country falls back to
 * the generic phrasing rather than defaulting to 911, which would be wrong
 * for most of the world.
 */
export default function EmergencyBanner({ countryCode }: Props) {
  const number = emergencyNumberFor(countryCode);

  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-5"
    >
      <h2 className="text-base font-bold text-red-700 dark:text-red-300">
        {number
          ? `If this could be an emergency, call ${number} now`
          : "If this could be an emergency, call your local emergency number now"}
      </h2>
      <p className="mt-1.5 text-sm text-red-800 dark:text-red-200">
        You marked this as emergency-adjacent. Walk-in clinics cannot treat
        chest pain, difficulty breathing, severe bleeding, stroke symptoms, or
        loss of consciousness. Call your local emergency number or go to the
        nearest emergency department instead of travelling to a clinic.
      </p>
      <p className="mt-2 text-sm text-red-800 dark:text-red-200">
        The clinic options below are listed only in case your situation turns
        out to be less urgent than it feels.
      </p>
    </div>
  );
}
