import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { endSession, requireUser } from "@/lib/auth";
import { Button } from "@/components/ui";
import { NavLink } from "@/components/nav-link";
import wordmark from "@/assets/rooney-law-wordmark.png";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/", label: "Dashboard" },
  { href: "/associations", label: "Associations" },
  { href: "/agents", label: "Registered agents" },
  { href: "/review", label: "Classification review" },
  { href: "/imports", label: "Imports and updates" },
  { href: "/exports", label: "Exports and backups" },
];

const ADMIN_SECTIONS = [{ href: "/users", label: "Users" }];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = user.role === "admin" ? [...SECTIONS, ...ADMIN_SECTIONS] : SECTIONS;

  async function signOutAction() {
    "use server";
    await endSession();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        <div className="border-b border-ink-200 px-4 py-4">
          {/*
            The wordmark is a wide horizontal lockup with a tagline, so it needs
            the full column width to stay legible; anything narrower turns the
            tagline to mush. A stacked or tagline-free mark would sit better in
            a sidebar this narrow — worth swapping in if the brand package has one.
          */}
          <Image
            src={wordmark}
            alt="Rooney Law, P.C."
            priority
            sizes="208px"
            className="h-auto w-full"
          />
          <p className="mt-3 text-xs font-medium text-ink-600">Illinois community associations</p>
          <p className="text-xs text-ink-400">Registered-agent market share</p>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {sections.map((section) => (
            <NavLink key={section.href} href={section.href}>
              {section.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-200 p-3">
          <Link
            href="/account"
            className="block truncate text-xs font-medium text-ink-700 hover:text-accent-700"
          >
            {user.displayName}
          </Link>
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
        <div className="flex items-center gap-2 overflow-x-auto border-b border-ink-200 bg-white px-3 py-2 md:hidden">
          <Image src={wordmark} alt="Rooney Law, P.C." className="h-5 w-auto shrink-0" priority />
          {[...sections, { href: "/account", label: "Your account" }].map((section) => (
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
