import { ProfileForm } from "@/module/settings/components/profile-form";
import { RepositoryList } from "@/module/settings/components/repository-list";
import { requireAuth } from "@/module/auth/utils/auth-utils";

export default async function SettingsPage() {
  await requireAuth();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Workspace</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h2>
        <p className="mt-2 text-muted-foreground">
          Manage your Codepool account and connected repositories.
        </p>
      </div>
      <ProfileForm />
      <RepositoryList />
    </div>
  );
}
