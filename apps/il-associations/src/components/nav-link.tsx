"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/** Sidebar link that highlights the section the visitor is currently in. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-accent-50 text-accent-700" : "text-ink-700 hover:bg-ink-100",
      )}
    >
      {children}
    </Link>
  );
}
