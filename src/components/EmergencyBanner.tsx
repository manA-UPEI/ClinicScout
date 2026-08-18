/**
 * Shown whenever the user flags their situation as emergency-adjacent. A clinic
 * recommendation is the wrong answer for a possible emergency, so this sits
 * above the results rather than beside them.
 */
export default function EmergencyBanner() {
  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30 p-5"
    >
      <h2 className="text-base font-bold text-red-700 dark:text-red-300">
        If this could be an emergency, call 911 now
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
