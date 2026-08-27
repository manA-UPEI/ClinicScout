import { usingFixtureData } from "@/application/config/runtimeMode";

/**
 * Says, unmissably, that nothing on the page is real.
 *
 * This app's entire premise is that a clinic fact is either confirmed or
 * shown as Unknown — never invented. Fixture mode invents all of them, which
 * is fine for development and dangerous anywhere else, so the warning is
 * loud, sits above everything including the sign-in row, and is not
 * dismissible. Someone who lands on a fixture deployment looking for actual
 * medical care needs to know inside a second.
 *
 * Rendered server-side from the same flag the adapters read, so it cannot
 * disagree with what is actually serving the data.
 */
export default function FixtureBanner() {
  if (!usingFixtureData()) return null;

  return (
    <div
      role="alert"
      className="w-full bg-amber-500 px-6 py-2 text-center text-sm font-semibold text-amber-950"
    >
      ⚠️ Fixture mode — every clinic, website and phone call below is invented
      test data. Do not use any of it to seek care.
    </div>
  );
}
