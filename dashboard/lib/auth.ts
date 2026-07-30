import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [
    "http://localhost:3000",
    "http://dashboard:3000",   // Docker inter-container
    "https://*.vercel.app",
  ],
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: schema,
  }),
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "user",
        input: false, // Security: prevent self-assignment of admin role on sign up
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Block sign-in for accounts that have not yet verified their email via OTP.
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false, // after sign-up the user must verify email, then sign in
  },
  plugins: [
    admin(),
    emailOTP({
      // Send the 6-digit OTP whenever better-auth needs to verify an email.
      // LOCAL DEV: OTP is printed to stdout — view with:
      //   docker logs drift-dashboard --follow | grep "EMAIL OTP"
      // PRODUCTION: replace console.log with your email provider (Resend, SendGrid, etc.)
      async sendVerificationOTP({ email, otp, type }) {
        console.log(`[EMAIL OTP] type=${type} | to=${email} | otp=${otp}`);
        // Example production swap (Resend):
        // await resend.emails.send({
        //   from: "noreply@yourdomain.com",
        //   to: email,
        //   subject: "Your DriftGuard verification code",
        //   text: `Your code is: ${otp}. It expires in 5 minutes.`,
        // });
      },
      // Automatically send an OTP when a new account is created via signUp.email()
      sendVerificationOnSignUp: true,
      // Replace the default "click a link" email verification with OTP flow
      overrideDefaultEmailVerification: true,
      // Don't allow signing-in-by-OTP to auto-create new accounts
      disableSignUp: true,
      otpLength: 6,
      expiresIn: 300,       // 5 minutes
      allowedAttempts: 5,
    }),
  ],
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "dummy",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "dummy",
    },
  },
});

