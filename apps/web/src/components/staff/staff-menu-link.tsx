"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getStaffRole, type StaffRole } from "@apartment-book/shared";
import { createClient } from "@/lib/supabase/client";

// One question per signed-in person per page load (the menu mounts each time it opens).
const roles = new Map<string, Promise<StaffRole | null>>();

function roleOf(userId: string): Promise<StaffRole | null> {
  let p = roles.get(userId);
  if (!p) {
    p = getStaffRole(createClient()).catch(() => null);
    roles.set(userId, p);
  }
  return p;
}

/** "Trust & Safety" in the account menu, for moderators and admins only (everyone else never sees the console). */
export function StaffMenuLink({ userId, onClick }: { userId: string; onClick: () => void }) {
  const [role, setRole] = useState<StaffRole | null>(null);
  useEffect(() => {
    let live = true;
    void roleOf(userId).then((r) => {
      if (live) setRole(r);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  if (!role) return null;
  return (
    <Link href="/admin" role="menuitem" onClick={onClick} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100" data-testid="menu-trust-safety">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-white">
        <ShieldCheck className="h-4 w-4" />
      </span>
      Trust &amp; Safety
    </Link>
  );
}
