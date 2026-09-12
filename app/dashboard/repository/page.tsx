import { GitBranch, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function RepositoryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          Repositories
        </h2>
        <p className="mt-2 text-muted-foreground">
          Connect GitHub repositories for pull request reviews.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <GitBranch className="size-6" />
          </span>
          <h3 className="font-semibold">No repositories connected</h3>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Your connected repositories will appear here once you add one.
          </p>
          <Button className="mt-6 gap-2">
            <Plus className="size-4" /> Connect repository
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
