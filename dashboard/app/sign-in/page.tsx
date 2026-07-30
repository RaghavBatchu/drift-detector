"use client";

import React, { useState, Suspense } from "react";
import { signIn } from "@/lib/auth-client";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const isVerified = searchParams.get("verified") === "true";

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please fill in all fields.");
      return;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
      });

      if (res?.error) {
        // Surface a clear message — better-auth returns "Invalid email or password"
        // for both "user not found" and "wrong password" to avoid account enumeration.
        setError(res.error.message || "Invalid email or password. Please check your credentials or sign up.");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signIn.social({
        provider: "github",
        callbackURL: callbackUrl,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Failed to connect to GitHub.";
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border border-border bg-card">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">Sign in to DriftGuard</CardTitle>
        <CardDescription>
          Enter your email and password to access your dashboard
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSignIn} className="space-y-4">
          {isVerified && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-500 font-medium">
              Email verified successfully! You can now sign in below.
            </div>
          )}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive animate-fadeIn">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 bg-muted/20 border-border"
                disabled={loading}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
              Password
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 bg-muted/20 border-border"
                disabled={loading}
              />
            </div>
          </div>
          <Button type="submit" className="w-full font-medium cursor-pointer" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Sign In
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <Button
          variant="outline"
          type="button"
          className="w-full border-border hover:bg-muted/50 cursor-pointer font-medium"
          onClick={handleGithubSignIn}
          disabled={loading}
        >
          <GithubIcon className="mr-2 h-4 w-4" />
          GitHub
        </Button>
      </CardContent>
      <CardFooter className="flex flex-col space-y-2 text-center text-sm text-muted-foreground border-t border-border pt-4">
        <p>
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="text-primary hover:underline font-medium">
            Sign up
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export default function SignInPage() {
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground animate-pulse">Loading sign in...</p>
        </div>
      }>
        <SignInForm />
      </Suspense>
    </div>
  );
}
