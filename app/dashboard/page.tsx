"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  MessageSquare,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommitHeatmap } from "@/module/github/components/CommitHeatmap";
import {
  getDashboardStats,
  getMonthlyActivity,
} from "@/module/dashboard/action";

export default function DashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
  });
  const activityQuery = useQuery({
    queryKey: ["monthly-activity"],
    queryFn: getMonthlyActivity,
  });
  const stats = statsQuery.data;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Workspace overview</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          GitHub Dashboard
        </h2>
        <p className="mt-2 text-muted-foreground">
          A clear view of your contribution and review activity.
        </p>
      </div>
      {statsQuery.isError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Could not load dashboard data. Check your GitHub connection and try
          again.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Commits"
          value={stats?.totalCommits}
          icon={<GitCommit className="size-4" />}
          loading={statsQuery.isLoading}
        />
        <StatCard
          title="Pull requests"
          value={stats?.totalPRs}
          icon={<GitPullRequest className="size-4" />}
          loading={statsQuery.isLoading}
        />
        <StatCard
          title="Reviews"
          value={
            stats?.totalReviews === undefined
              ? undefined
              : Number(stats.totalReviews)
          }
          icon={<MessageSquare className="size-4" />}
          loading={statsQuery.isLoading}
        />
        <StatCard
          title="Repositories"
          value={
            stats?.totalRepos === undefined
              ? undefined
              : Number(stats.totalRepos)
          }
          icon={<GitBranch className="size-4" />}
          loading={statsQuery.isLoading}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Contribution activity</CardTitle>
          <CardDescription>
            Your GitHub commits over the last year.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {statsQuery.isLoading ? (
            <LoadingState label="Loading heatmap…" />
          ) : stats?.heatmapWeeks?.length ? (
            <CommitHeatmap weeks={stats.heatmapWeeks} />
          ) : (
            <LoadingState label="No contribution activity available yet." />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Monthly activity</CardTitle>
          <CardDescription>
            Commits, pull requests, and reviews over the last six months.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[320px]">
          {activityQuery.isLoading ? (
            <LoadingState label="Loading chart…" />
          ) : activityQuery.data?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={activityQuery.data}
                margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    borderColor: "var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                />
                <Legend />
                <Bar
                  dataKey="commits"
                  name="Commits"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="prs"
                  name="PRs"
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="reviews"
                  name="Reviews"
                  fill="var(--chart-5)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <LoadingState label="No activity available yet." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value?: number;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-primary">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{loading ? "—" : (value ?? 0)}</p>
      </CardContent>
    </Card>
  );
}
function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-28 items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
