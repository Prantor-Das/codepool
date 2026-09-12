"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RepositoryListSkeleton } from "@/module/repository/components/repository-list-skeleton";
import { useRepository } from "@/module/repository/hooks/use-repository";
import { useConnectRepo } from "@/module/repository/hooks/use-connect";

export default function RepositoryPage() {
  const [search, setSearch] = useState("");
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRepository();
  const {
    mutate: connectRepo,
    isPending,
    isError: isConnectError,
    error: connectError,
  } = useConnectRepo();
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const [connectedName, setConnectedName] = useState<string | null>(null);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  const repositories = data?.pages.flat() ?? [];
  const filtered = repositories.filter((repo) =>
    `${repo.name} ${repo.full_name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  if (isLoading)
    return (
      <div className="mx-auto w-full max-w-6xl">
        <RepositoryListSkeleton count={4} />
      </div>
    );
  if (isError)
    return (
      <div className="mx-auto w-full max-w-6xl rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Could not load your GitHub repositories. Reconnect GitHub and try again.
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          Repositories
        </h2>
        <p className="mt-2 text-muted-foreground">
          Connect GitHub repositories for pull request reviews.
        </p>
      </div>
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search repositories"
          placeholder="Search repositories…"
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {isConnectError && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {connectError instanceof Error
            ? connectError.message
            : "Could not connect this repository."}
        </p>
      )}
      {connectedName && (
        <p
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm text-primary"
        >
          {connectedName}
        </p>
      )}
      <div className="grid gap-4">
        {filtered.map((repo) => (
          <Card key={repo.id} className="transition-shadow hover:shadow-md">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-lg">{repo.name}</CardTitle>
                    <Badge variant="outline">
                      {repo.language ?? "Unknown"}
                    </Badge>
                    {repo.isConnected && (
                      <Badge variant="secondary">Connected</Badge>
                    )}
                  </div>
                  {repo.description && (
                    <CardDescription className="line-clamp-2">
                      {repo.description}
                    </CardDescription>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <a
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    href={repo.html_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${repo.full_name} on GitHub`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                  <Button
                    disabled={repo.isConnected || isPending}
                    onClick={() => {
                      const [owner, name] = repo.full_name.split("/");
                      if (!owner || !name) return;
                      setConnectingId(repo.id);
                      setConnectedName(null);
                      connectRepo(
                        { owner, repo: name, githubId: repo.id },
                        {
                          onSuccess: (result) =>
                            setConnectedName(
                              result.webhookCreated
                                ? `${repo.name} connected successfully. Indexing will begin shortly.`
                                : `${repo.name} connected. Webhooks are disabled for localhost; use a public URL to enable automatic reviews.`,
                            ),
                          onSettled: () => setConnectingId(null),
                        },
                      );
                    }}
                  >
                    {connectingId === repo.id
                      ? "Connecting…"
                      : repo.isConnected
                        ? "Connected"
                        : "Connect"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Star className="size-4 fill-primary text-primary" />
                {repo.stargazers_count.toLocaleString()}
              </span>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No repositories match your search.
            </CardContent>
          </Card>
        )}
        <div
          ref={loadMoreRef}
          className="py-2 text-center text-sm text-muted-foreground"
        >
          {isFetchingNextPage
            ? "Loading more repositories…"
            : !hasNextPage && repositories.length > 0
              ? "You’ve reached the end."
              : null}
        </div>
      </div>
    </div>
  );
}
