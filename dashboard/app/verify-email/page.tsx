"use client";

import React, { useState, useRef, useEffect, Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MailCheck, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function VerifyEmailForm() {
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return (
      <Card className="w-full max-w-md border border-border bg-card">
        <CardContent className="pt-8 text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            No email address provided. Please{" "}
            <Link href="/sign-up" className="text-primary hover:underline font-medium">
              sign up again
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleChange = (index: number, value: string) => {
    // Only allow single digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const next = [...otp];
        next[index] = "";
        setOtp(next);
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    }
    if (e.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const next = Array(6).fill("");
    pasted.split("").forEach((ch, i) => { next[i] = ch; });
    setOtp(next);
    // Focus the last filled cell
    const lastIdx = Math.min(pasted.length, 5);
    inputRefs.current[lastIdx]?.focus();
  };

  const handleVerify = async () => {
    const code = otp.join("");
    if (code.length < 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await authClient.emailOtp.verifyEmail({
        email,
        otp: code,
      });

      if (res?.error) {
        setError(res.error.message || "Invalid or expired code. Please try again.");
      } else {
        setSuccess(true);
        // Brief success moment then redirect to sign-in
        setTimeout(() => {
          router.push(`/sign-in?verified=true&email=${encodeURIComponent(email)}`);
        }, 1800);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError(null);

    try {
      const res = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (res?.error) {
        setError(res.error.message || "Failed to resend code.");
      } else {
        setCooldown(60);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setResending(false);
    }
  };

  return (
    <Card className="w-full max-w-md border border-border bg-card shadow-lg">
      <CardHeader className="space-y-3 text-center pb-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
          <MailCheck className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">Verify your email</CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          We sent a 6-digit code to{" "}
          <span className="font-semibold text-foreground">{email}</span>.
          <br />
          Enter it below to activate your account.
          <br />
          <span className="text-xs text-muted-foreground/70">
            (Local dev: check{" "}
            <code className="font-mono bg-muted px-1 rounded text-[10px]">
              docker logs drift-dashboard
            </code>
            )
          </span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive transition-all duration-200">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-500 flex items-center gap-2 transition-all duration-200">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Email verified! Redirecting to sign-in…
          </div>
        )}

        {/* OTP Input Grid */}
        <div className="flex justify-center gap-2.5">
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              disabled={loading || success}
              className={`
                w-11 h-13 text-center text-xl font-bold rounded-lg border-2 bg-muted/20
                transition-all duration-150 outline-none
                focus:border-primary focus:bg-primary/5 focus:ring-2 focus:ring-primary/20
                disabled:opacity-50 disabled:cursor-not-allowed
                ${digit ? "border-primary/60" : "border-border"}
              `}
              style={{ height: "3.25rem" }}
            />
          ))}
        </div>

        <Button
          onClick={handleVerify}
          className="w-full font-medium cursor-pointer"
          disabled={loading || success || otp.join("").length < 6}
        >
          {loading ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Verifying…</>
          ) : success ? (
            <><ShieldCheck className="h-4 w-4 mr-2" /> Verified!</>
          ) : (
            "Verify Email"
          )}
        </Button>
      </CardContent>

      <CardFooter className="flex flex-col items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <p>Didn&apos;t receive a code?</p>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary hover:text-primary/80 cursor-pointer gap-1.5"
          onClick={handleResend}
          disabled={resending || cooldown > 0 || success}
        >
          {resending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </Button>
        <Link
          href="/sign-up"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
        >
          ← Back to sign up
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex items-center justify-center min-h-[75vh] px-4">
      <Suspense
        fallback={
          <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
          </div>
        }
      >
        <VerifyEmailForm />
      </Suspense>
    </div>
  );
}
