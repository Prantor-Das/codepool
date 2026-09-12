"use client";

import { signOut } from "@/lib/auth-client";
import { Loader2, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

const Logout = ({
  children,
  classname,
}: {
  children?: React.ReactNode;
  classname?: string;
}) => {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const result = await signOut();
      if (result.error) {
        setLoading(false);
        return;
      }

      router.replace("/login");
    } catch {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className={classname ?? "flex items-center gap-2 text-sm"}
      onClick={handleLogout}
      disabled={loading}
      aria-label="Log out"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      {children ?? "Logout"}
    </button>
  );
};

export default Logout;
