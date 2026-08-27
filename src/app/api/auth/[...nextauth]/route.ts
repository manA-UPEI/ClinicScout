import { handlers } from "@/infrastructure/auth/nextAuth";

// Sign-in, callback, sign-out, session and CSRF endpoints, all served by
// Auth.js under /api/auth/*. The basePath is next-auth's own default; the
// catch-all segment name is the convention Auth.js documents.
//
// This is a route handler under app/api/, the one place the layering rules
// allow wiring an infrastructure adapter in directly.
export const { GET, POST } = handlers;
