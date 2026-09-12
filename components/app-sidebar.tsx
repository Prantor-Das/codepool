"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import Link from "next/link";

import Logout from "@/module/auth/components/logout";
import { navigationItems } from "@/lib/types";

type SidebarUser = {
  name: string;
  email: string;
  image: string | null;
};

const AppSidebar = ({ user }: { user: SidebarUser }) => {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  const isActive = (url: string) =>
    pathname === url || pathname.startsWith(url + "/");

  const username = user.name || "GUEST";
  const email = user.email || "";
  const initials = username
    .split(" ")
    .map((n) => n[0])
    .join("");

  return (
    <Sidebar>
      {/* HEADER */}
      <SidebarHeader className="border-b">
        <div className="px-3 py-4">
          <div className="flex items-center gap-3 rounded-lg bg-sidebar-accent/50 p-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.image ?? ""} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide">
                Connected Account
              </p>
              <p className="truncate text-sm font-medium">{username}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
        </div>
      </SidebarHeader>

      {/* CONTENT */}
      <SidebarContent className=" px-3 py-6 flex-col gap-1">
        <div className=" text-sm font-semibold text-sidebar-accent-foreground/60 px-3 mb-3 uppercase tracking-widest">
          {" "}
          Menu
        </div>
        <SidebarMenu className=" gap-2">
          {navigationItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                render={<Link href={item.url} />}
                tooltip={item.title}
                className={`h-11 px-4 rounded-lg transition-all duration-200 ${
                  isActive(item.url)
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent/60 text-sidebar-foreground"
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span className=" text-sm  font-medium">{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      {/* FOOTER */}
      <SidebarFooter className="border-t">
        <div className="flex items-center justify-between px-3 py-4">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex items-center gap-2 text-sm"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
            Switch Theme
          </button>

          <Logout>
            Logout
          </Logout>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
