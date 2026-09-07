"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bookmark, Building2, ChevronDown, LogOut, Plus, Settings, ShoppingBag, User, Users } from "lucide-react";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";

function Dropdown({
  trigger,
  label,
  children,
  align = "right",
}: {
  trigger: (open: boolean) => ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label={label} className="block">
        {trigger(open)}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-2 w-60 overflow-hidden rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-gray-200",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, icon: Icon, children, onClick }: { href: string; icon: typeof Plus; children: ReactNode; onClick: () => void }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-700">
        <Icon className="h-4 w-4" />
      </span>
      {children}
    </Link>
  );
}

export function CreateMenu() {
  return (
    <Dropdown
      label="Create"
      trigger={() => (
        <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-gray-200 px-3 text-sm font-semibold text-gray-900 hover:bg-gray-300">
          <Plus className="h-5 w-5" />
          <span className="hidden lg:inline">Create</span>
          <ChevronDown className="hidden h-4 w-4 lg:inline" />
        </span>
      )}
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Create</p>
          <MenuLink href="/apartments/new" icon={Building2} onClick={close}>
            Apartment listing
          </MenuLink>
          <MenuLink href="/roommates/new" icon={Users} onClick={close}>
            Roommate post
          </MenuLink>
          <MenuLink href="/marketplace/new" icon={ShoppingBag} onClick={close}>
            Marketplace item
          </MenuLink>
        </>
      )}
    </Dropdown>
  );
}

export function UserMenu({ userId, name, avatarUrl }: { userId: string; name: string; avatarUrl: string | null }) {
  return (
    <Dropdown
      label="Account menu"
      trigger={() => <Avatar name={name} src={avatarUrl} size="md" className="ring-2 ring-transparent hover:ring-gray-300" />}
    >
      {(close) => (
        <>
          <Link
            href={`/profile/${userId}`}
            onClick={close}
            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-100"
          >
            <Avatar name={name} src={avatarUrl} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-900">{name}</span>
              <span className="block text-xs text-gray-500">View your profile</span>
            </span>
          </Link>
          <div className="my-1 h-px bg-gray-100" />
          <MenuLink href="/profile/me" icon={User} onClick={close}>
            My listings
          </MenuLink>
          <MenuLink href="/saved" icon={Bookmark} onClick={close}>
            Saved
          </MenuLink>
          <MenuLink href="/settings/profile" icon={Settings} onClick={close}>
            Settings
          </MenuLink>
          <div className="my-1 h-px bg-gray-100" />
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-700">
                <LogOut className="h-4 w-4" />
              </span>
              Log out
            </button>
          </form>
        </>
      )}
    </Dropdown>
  );
}
