import { FileSearch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function ReviewsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Reviews</h2>
        <p className="mt-2 text-muted-foreground">
          Track pull request reviews across your repositories.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <FileSearch className="mb-4 size-10 text-muted-foreground" />
          <h3 className="font-semibold">No reviews yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Reviews will show up here after you connect a repository.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
