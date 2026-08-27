import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { accountSubject } from "./sessionUser.ts";
import {
  readConfiguredAuthProviders,
  type AuthProviderId,
} from "../config/authProviders.ts";

/**
 * Auth.js lives here and nowhere else.
 *
 * Everything above infrastructure/ goes through the SessionReader port
 * (application/ports/sessionReader.ts) instead of importing this module, so
 * next-auth being a `5.0.0-beta` is contained: if it has to be swapped for a
 * hand-rolled OAuth + jose session, this file and its adapter are the
 * blast radius.
 */
const FACTORIES = { github: GitHub, google: Google } as const;

/**
 * Only providers with credentials present are registered — see
 * ../config/authProviders.ts. An empty list is a valid configuration: the app
 * runs anonymous-only, which is a supported tier rather than a broken state.
 */
function configuredProviders() {
  return readConfiguredAuthProviders().map((id: AuthProviderId) => FACTORIES[id]);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: configuredProviders(),

  // No database, so no session table to look anything up in: the session is
  // a signed, encrypted cookie and nothing else. This is the whole reason
  // auth here costs no hosting — and the reason there is no account linking.
  session: { strategy: "jwt" },

  callbacks: {
    // `account` is only populated on the request that completes a sign-in;
    // every later request re-reads the token that was minted here. Setting
    // the subject once, at that moment, is what makes the id stable for the
    // life of the session.
    jwt({ token, account }) {
      if (account) {
        token.sub = accountSubject(account.provider, account.providerAccountId);
      }
      return token;
    },

    // Auth.js does not surface the token subject on the session by default,
    // and `session.user.id` is what every caller of the SessionReader port
    // keys on. Without this the mapper would see an id-less user and report
    // every signed-in caller as anonymous.
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
