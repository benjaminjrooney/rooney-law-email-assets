import Link from "next/link";
import { redirect } from "next/navigation";
import { endSession, requireUser } from "@/lib/auth";
import { Button } from "@/components/ui";
import { NavLink } from "@/components/nav-link";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/", label: "Dashboard" },
  { href: "/associations", label: "Associations" },
  { href: "/agents", label: "Registered agents" },
  { href: "/review", label: "Classification review" },
  { href: "/imports", label: "Imports and updates" },
  { href: "/exports", label: "Exports and backups" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  async function signOutAction() {
    "use server";
    await endSession();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        <div className="border-b border-ink-200 px-4 py-4">
          <p className="text-sm font-semibold leading-tight text-ink-900">
            Illinois Community
            <br />
            Associations
          </p>
          <p className="mt-1 text-xs text-ink-500">Market-share database</p>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {SECTIONS.map((section) => (
            <NavLink key={section.href} href={section.href}>
              {section.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3">
          <p className="truncate text-xs font-medium text-ink-700">{user.displayName}</p>
          <p className="truncate text-xs text-ink-500">
            {user.email} · {user.role}
          </p>
          <form action={signOutAction} className="mt-2">
            <Button type="submit" variant="secondary" size="sm" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact navigation for narrow screens, where the sidebar is hidden. */}
        <div className="flex gap-1 overflow-x-auto border-b border-ink-200 bg-white px-2 py-2 md:hidden">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100"
            >
              {section.label}
            </Link>
          ))}
        </div>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
