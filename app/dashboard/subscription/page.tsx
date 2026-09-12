import { CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function SubscriptionPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">
          Subscription
        </h2>
        <p className="mt-2 text-muted-foreground">
          Manage your Codepool workspace plan.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <CreditCard className="mb-4 size-10 text-muted-foreground" />
          <h3 className="font-semibold">Free workspace</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Your plan details and upgrade options will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
