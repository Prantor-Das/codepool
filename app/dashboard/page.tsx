import {
  ArrowUpRight,
  GitPullRequest,
  Package,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const stats = [
  {
    label: "Repositories",
    value: "0",
    icon: Package,
    note: "Connect a repository to begin",
  },
  {
    label: "Open reviews",
    value: "0",
    icon: GitPullRequest,
    note: "Your queue is clear",
  },
  {
    label: "Issues caught",
    value: "—",
    icon: ShieldCheck,
    note: "Insights appear after your first review",
  },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">Good to see you</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          Your workspace
        </h2>
        <p className="mt-2 text-muted-foreground">
          Connect a repository to start building a useful review history.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map(({ label, value, icon: Icon, note }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
              <Icon className="size-4 text-primary" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Start with a repository</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first GitHub repository from the Repository section.
            </p>
          </div>
          <a
            href="/dashboard/repository"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            Go to repositories <ArrowUpRight className="size-4" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
