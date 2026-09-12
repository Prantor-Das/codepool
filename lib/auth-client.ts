import { createAuthClient } from "better-auth/react";

// The GitHub OAuth app is configured for /api/callback/github.
const appURL = (process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");

export const { signIn, signUp, signOut, useSession } = createAuthClient({
    baseURL: `${appURL}/api`,
});
