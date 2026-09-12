export interface LayoutProp {
  children: React.ReactNode;
}

import { BookOpen, GitBranch, Settings } from "lucide-react";

export const navigationItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: BookOpen,
  },
  {
    title: "Repository",
    url: "/dashboard/repository",
    icon: GitBranch,
  },
  {
    title: "Reviews",
    url: "/dashboard/reviews",
    icon: BookOpen,
  },
  {
    title: "Subscription",
    url: "/dashboard/subscription",
    icon: BookOpen,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
];
