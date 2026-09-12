"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getReviewById, getReviews } from "@/module/reviews/action";
import { parseReviewOutput, ReviewContent } from "@/module/reviews/components/review-content";

export default function ReviewsPage() {
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const reviewsQuery = useQuery({
    queryKey: ["reviews"],
    queryFn: () => getReviews(),
    refetchInterval: 15_000,
  });
  const selectedReviewQuery = useQuery({
    queryKey: ["review", selectedReviewId],
    queryFn: () => getReviewById(selectedReviewId!),
    enabled: selectedReviewId !== null,
  });

  const reviews = reviewsQuery.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Reviews</h2>
        <p className="mt-2 text-muted-foreground">
          Track pull request reviews across your repositories.
        </p>
      </div>

      {reviewsQuery.isLoading ? (
        <ReviewListSkeleton />
      ) : reviewsQuery.isError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load your reviews. Please try again in a moment.
        </p>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <FileSearch className="mb-4 size-10 text-muted-foreground" />
            <h3 className="font-semibold">No reviews yet</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Reviews will show up here after you connect a repository.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-muted/50"
                onClick={() => setSelectedReviewId(review.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{review.repositoryFullName}</span>
                    <span className="text-muted-foreground">#{review.prNumber}</span>
                    <StatusBadge status={review.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{review.prTitle}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatTimestamp(review.createdAt)}</p>
                </div>
                <a
                  href={review.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open pull request #${review.prNumber} on GitHub`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ExternalLink className="size-4" />
                </a>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={selectedReviewId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedReviewId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          {selectedReviewQuery.isLoading ? (
            <ReviewDetailSkeleton />
          ) : selectedReviewQuery.isError || !selectedReviewQuery.data ? (
            <p className="text-sm text-destructive">Could not load this review.</p>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedReviewQuery.data.repositoryFullName} #{selectedReviewQuery.data.prNumber}
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2">
                  <span>{selectedReviewQuery.data.prTitle}</span>
                  <StatusBadge status={selectedReviewQuery.data.status} />
                </DialogDescription>
              </DialogHeader>
              {selectedReviewQuery.data.status === "pending" ? (
                <p className="text-sm text-muted-foreground">
                  This review is still being generated. The list will update automatically.
                </p>
              ) : (
                <div className="max-w-none space-y-4 text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-xs [&_strong]:font-semibold [&_ul]:space-y-1">
                  <ReviewBody value={selectedReviewQuery.data.review} />
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewBody({ value }: { value: string }) {
  const review = parseReviewOutput(value);
  return review ? <ReviewContent review={review} /> : <pre className="whitespace-pre-wrap">{value}</pre>;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "failed" ? "destructive" : status === "pending" ? "secondary" : "default";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function ReviewListSkeleton() {
  return (
    <Card>
      <CardContent className="divide-y p-0">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-3 p-5">
            <div className="flex gap-2"><Skeleton className="h-5 w-44" /><Skeleton className="h-5 w-16" /></div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReviewDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}
