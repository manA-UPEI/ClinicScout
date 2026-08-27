import { getCurrentUser, isSignInAvailable } from "@/application/auth/getCurrentUser";

const LINK_CLASS =
  "underline underline-offset-2 transition-colors hover:text-gray-700 dark:hover:text-gray-200";

/**
 * Who you are, and the one link that changes it.
 *
 * Renders nothing at all when the deployment has no OAuth credentials, so a
 * local clone without them looks like the app did before auth existed rather
 * than offering a button that dead-ends in an Auth.js error.
 *
 * Plain `<a>` rather than next/link: /api/auth/* are route handlers served by
 * Auth.js, not app routes, so there is no client-side navigation or prefetch
 * to be had — and prefetching a sign-out URL is an actively bad idea.
 *
 * Sign-in and sign-out both go to Auth.js's own built-in pages, which means
 * this phase ships no client JS, no SessionProvider, and no server actions
 * for auth. A branded sign-in page is a later, cosmetic change.
 */
export default async function AuthStatus() {
  if (!isSignInAvailable()) return null;

  const user = await getCurrentUser();

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center justify-end gap-3 px-6 pt-4 text-xs text-gray-500 dark:text-gray-400">
      {user ? (
        <>
          {/* Whatever the provider gave us, in descending order of how much it
              looks like a person. Both can be withheld. */}
          <span className="max-w-[12rem] truncate">
            {user.name ?? user.email ?? "Signed in"}
          </span>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              the catch-all segment makes this look like a page to the rule,
              but /api/auth/* is a route handler: next/link would attempt an
              RSC navigation to it and prefetch a sign-out URL. */}
          <a href="/api/auth/signout" className={LINK_CLASS}>
            Sign out
          </a>
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-html-link-for-pages -- see above
        <a href="/api/auth/signin" className={LINK_CLASS}>
          Sign in
        </a>
      )}
    </div>
  );
}
