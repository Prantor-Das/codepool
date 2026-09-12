"use client";

import { signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

const GithubMark = () => (
  <svg aria-hidden="true" className="size-4 fill-current" viewBox="0 0 24 24">
    <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.4-1.34-1.77-1.34-1.77-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.23 1.84 1.23 1.07 1.83 2.8 1.3 3.48.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.76.84 1.23 1.91 1.23 3.22 0 4.62-2.81 5.65-5.49 5.94.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
  </svg>
);

export default function SignupUI() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password"));
    const confirmPassword = String(formData.get("confirmPassword"));

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const result = await signUp.email({
      name: String(formData.get("name")),
      email: String(formData.get("email")),
      password,
      callbackURL: "/dashboard",
    });

    if (result.error) {
      setError(result.error.message || "We couldn't create your account.");
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
  };

  const handleGithubSignup = async () => {
    setLoading(true);
    setError(null);
    const result = await signIn.social({
      provider: "github",
      callbackURL: "/dashboard",
    });
    if (result.error) {
      setError(
        result.error.message || "GitHub sign-up failed. Please try again.",
      );
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="pointer-events-none absolute -left-40 -top-40 h-96 w-96 rounded-full bg-secondary/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-24 h-[28rem] w-md rounded-full bg-muted blur-3xl" />

      <section className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-card shadow-xl md:grid-cols-[0.9fr_1.1fr]">
        <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground md:flex lg:p-12">
          <div>
            <div className="mb-16 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-sm font-bold text-secondary-foreground">
                CR
              </div>
              <span className="text-sm font-semibold tracking-wide">
                CodePool
              </span>
            </div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-secondary">
              Start shipping smarter
            </p>
            <h1 className="max-w-sm text-4xl font-semibold leading-tight tracking-[-0.04em] lg:text-5xl">
              Your code deserves a second set of eyes.
            </h1>
            <p className="mt-6 max-w-sm text-sm leading-6 text-primary-foreground/70">
              Create your workspace and bring thoughtful, automated reviews into
              every pull request.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-primary-foreground/60">
            <ShieldCheck className="size-4 text-secondary" />
            Secure workspace access
          </div>
        </div>

        <div className="p-7 sm:p-10 lg:p-14">
          <div className="mx-auto max-w-md">
            <div className="mb-8 md:hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                  CR
                </div>
                <span className="text-sm font-semibold tracking-wide">
                  CodePool
                </span>
              </div>
            </div>
            <div className="mb-8">
              <p className="mb-2 text-sm font-medium text-primary">
                One step away
              </p>
              <h2 className="text-3xl font-semibold tracking-[-0.04em]">
                Create your account
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Set up your workspace and start reviewing with confidence.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSignup}>
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="name"
                    name="name"
                    placeholder="Ada Lovelace"
                    className="h-11 pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@company.com"
                    className="h-11 pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    minLength={8}
                    placeholder="At least 8 characters"
                    className="h-11 pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  minLength={8}
                  placeholder="Repeat your password"
                  className="h-11"
                  required
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
              <Button type="submit" className="h-11 w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                {loading ? "Creating account..." : "Create account"}
              </Button>
            </form>

            <div className="my-7 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">
                OR CONTINUE WITH
              </span>
              <Separator className="flex-1" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-2"
              onClick={handleGithubSignup}
              disabled={loading}
            >
              <GithubMark />
              {loading ? "Connecting..." : "Continue with GitHub"}
            </Button>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
            <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
              By creating an account, you agree to our{" "}
              <Link href="#" className="underline underline-offset-2">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="#" className="underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
