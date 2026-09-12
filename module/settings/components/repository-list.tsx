"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, GitBranch, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getConnectedRep,
  disconnetRepo,
  disconnectAllRepos,
} from "@/module/settings/actions";
import { RepositoryListSkeleton } from "@/module/settings/components/RepositoryListSkeleton";

export function RepositoryList() {
  const queryClient = useQueryClient();
  const [disconnectAllOpen, setDisconnectAllOpen] = useState(false);
  const repositoriesQuery = useQuery({
    queryKey: ["connected-repositories"],
    queryFn: getConnectedRep,
  });
  const disconnectMutation = useMutation({
    mutationFn: disconnetRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connected-repositories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });
  const disconnectAllMutation = useMutation({
    mutationFn: disconnectAllRepos,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connected-repositories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setDisconnectAllOpen(false);
    },
  });

  if (repositoriesQuery.isLoading) return <RepositoryListSkeleton count={3} />;
  if (repositoriesQuery.isError)
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Could not load connected repositories.
      </p>
    );
  const repositories = repositoriesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="size-4" /> Connected repositories
            </CardTitle>
            <CardDescription className="mt-1">
              Repositories monitored by Codepool for pull request reviews.
            </CardDescription>
          </div>
          {repositories.length > 0 && (
            <AlertDialog
              open={disconnectAllOpen}
              onOpenChange={setDisconnectAllOpen}
            >
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm" />}
              >
                Disconnect all
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="size-5 text-destructive" />
                    Disconnect all repositories?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes all connected repositories and their GitHub
                    webhooks. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    disabled={disconnectAllMutation.isPending}
                    onClick={() => disconnectAllMutation.mutate()}
                  >
                    {disconnectAllMutation.isPending
                      ? "Disconnecting…"
                      : "Disconnect all"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {repositories.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No repositories connected yet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Visit Repositories to connect your first GitHub repository.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {repositories.map((repository) => (
              <div
                key={repository.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">
                      {repository.fullName}
                    </p>
                    <Badge variant="secondary">Connected</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connected on{" "}
                    {new Date(repository.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    href={repository.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${repository.fullName} on GitHub`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={`Disconnect ${repository.fullName}`}
                    disabled={disconnectMutation.isPending}
                    onClick={() => disconnectMutation.mutate(repository.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {disconnectMutation.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {disconnectMutation.error instanceof Error
              ? disconnectMutation.error.message
              : "Failed to disconnect repository."}
          </p>
        )}
        {disconnectAllMutation.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {disconnectAllMutation.error instanceof Error
              ? disconnectAllMutation.error.message
              : "Failed to disconnect repositories."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
