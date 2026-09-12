import { LayoutProp } from "@/lib/types";
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from "@/components/ui/sidebar";
import AppSidebar from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { requireAuth } from "@/module/auth/utils/auth-utils";

const DashBoardLayout = async ({ children }: LayoutProp) => {
  await requireAuth();
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
        </header>
        <main className="flex-1 overflow-auto bg-muted/20 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default DashBoardLayout;
