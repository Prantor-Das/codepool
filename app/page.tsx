import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-secondary/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-24 size-[32rem] rounded-full bg-muted blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3"
            aria-label="Codepool home"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
              CP
            </span>
            <span className="font-semibold tracking-tight">Codepool</span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
              <Sparkles className="size-3.5 text-primary" /> Thoughtful reviews,
              less noise
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Ship better code, together.
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
              Codepool gives your repositories a calm, focused home for pull
              request reviews—so your team can catch issues early and keep
              moving.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button
                nativeButton={false}
                render={<Link href="/signup" />}
                size="lg"
                className="h-12 gap-2 px-6"
              >
                Create your workspace <ArrowRight className="size-4" />
              </Button>
              <Button
                nativeButton={false}
                render={<Link href="/login" />}
                size="lg"
                variant="outline"
                className="h-12 gap-2 px-6"
              >
                <GitBranch className="size-4" /> Connect with GitHub
              </Button>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-primary" />{" "}
                Repository-first workflow
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Secure workspace
                access
              </span>
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card/90 p-5 shadow-xl shadow-primary/5 sm:p-7">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Workspace overview
                </p>
                <p className="mt-1 text-lg font-semibold">Your review queue</p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                Live
              </span>
            </div>
            <div className="space-y-3">
              {[
                "Improve error handling",
                "Add loading state",
                "Refresh API types",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 p-4"
                >
                  <span
                    className={`size-2.5 rounded-full ${index === 0 ? "bg-primary" : "bg-secondary"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      pull/{index + 24} · codepool/app
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {index + 1}h
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-border pt-5 text-sm">
              <span className="text-muted-foreground">3 reviews ready</span>
              <Link
                href="/login"
                className="font-medium text-primary hover:underline"
              >
                Open workspace
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-border pt-5 text-xs text-muted-foreground">
          A focused code review workspace for teams that care about the details.
        </footer>
      </div>
    </main>
  );
}
