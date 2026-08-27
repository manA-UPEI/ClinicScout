/**
 * Persistent, not conditional on a search having run: EmergencyBanner only
 * appears once a result is showing, and RecommendationView's own disclaimer
 * text is the same — both arrive only after a search that can take up to
 * 40s. Someone typing during an actual emergency should see this before
 * they've finished typing, not after.
 */
export default function Footer() {
  return (
    <footer className="mx-auto w-full max-w-2xl px-6 pb-6 pt-2 text-center text-xs text-gray-400 dark:text-gray-500">
      <p>
        Not medical advice or an emergency service. If this could be an
        emergency, call 911 (or your local emergency number) now rather than
        waiting on a search.
      </p>
      <p className="mt-1.5">
        Your typed location is used only to run this search — sent to
        OpenStreetMap and Google to find and verify clinics, and cached for up
        to 24 hours so a repeat search is faster. It is not used for anything
        beyond answering this search.
      </p>
      <p className="mt-1.5">
        Signing in is optional and the app works without it. If you do, your
        browser holds a signed session cookie carrying an identifier from your
        provider — never a password — and that is the whole of what is kept
        about you. Your searches are not recorded against it.
      </p>
    </footer>
  );
}
