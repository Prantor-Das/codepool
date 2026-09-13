"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getUserProfile, updateUserProfile } from "@/module/settings/actions";

export function ProfileForm() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; email: string } | null>(
    null,
  );
  const [saved, setSaved] = useState(false);
  const profileQuery = useQuery({
    queryKey: ["user-profile"],
    queryFn: getUserProfile,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const updateMutation = useMutation({
    mutationFn: updateUserProfile,
    onSuccess: (result) => {
      if (!result.user) return;
      queryClient.setQueryData(["user-profile"], result.user);
      setDraft({ name: result.user.name, email: result.user.email });
      setSaved(true);
    },
  });

  if (profileQuery.isLoading) {
    return <ProfileFormSkeleton />;
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Could not load your profile.
      </p>
    );
  }

  const name = draft?.name ?? profileQuery.data.name ?? "";
  const email = draft?.email ?? profileQuery.data.email ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile settings</CardTitle>
        <CardDescription>
          Update the personal information used by Codepool.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            updateMutation.mutate({ name, email });
          }}
          className="max-w-xl space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) =>
                setDraft({ name: event.target.value, email })
              }
              disabled={updateMutation.isPending}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              readOnly
              type="email"
              value={email}
              onChange={(event) =>
                setDraft({ name, email: event.target.value })
              }
              disabled={updateMutation.isPending}
              autoComplete="email"
            />
            <p className="text-xs text-muted-foreground">Your sign-in email cannot be changed here.</p>
          </div>
          {updateMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {updateMutation.error instanceof Error
                ? updateMutation.error.message
                : "Failed to update your profile."}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-primary">
              Profile updated successfully.
            </p>
          )}
          <Button
            type="submit"
            disabled={updateMutation.isPending || !name.trim() || !email.trim()}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ProfileFormSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile settings</CardTitle>
        <CardDescription>Loading your profile…</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="max-w-xl animate-pulse space-y-5">
          <div className="h-10 rounded-lg bg-muted" />
          <div className="h-10 rounded-lg bg-muted" />
          <div className="h-8 w-28 rounded-lg bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
