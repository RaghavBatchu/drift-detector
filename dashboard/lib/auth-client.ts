import { createAuthClient } from "better-auth/react";
import { adminClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), adminClient()],
});

export const { useSession, signIn, signOut, signUp } = authClient;
