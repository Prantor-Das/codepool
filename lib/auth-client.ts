import { createAuthClient } from "better-auth/react";

// Better Auth uses /api/auth/callback/github for the GitHub OAuth callback.
const appURL = (
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000"
).replace(/\/$/, "");

export const { signIn, signUp, signOut, useSession } = createAuthClient({
  baseURL: appURL,
});
