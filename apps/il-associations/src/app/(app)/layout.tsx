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
        {/*
          The sidebar is 240px wide and the wordmark's stated screen minimum is
          240px with 20px of clear space on each side, so the mark cannot go
          here: the Brand Guide's instruction for a slot this narrow is the
          compact mark (`Logos/email-logo.png`, minimum 120px) or the square
          monogram, and neither file is in this repository yet.

          So this is the firm's approved cross-channel framework instead — a
          charcoal title band with an ivory editorial heading and a teal detail,
          above light content fields. Type, not the mark, which is the one thing
          the guide does not restrict. Drop `email-logo.png` into src/assets and
          it belongs above the rule at 176px.

          On charcoal, teal is a graphic and not a text colour: it measures
          2.48:1 against it. The rule below is the teal detail; the secondary
          line is the light neutral the guide names for exactly this, at 6.5:1.
        */}
        <div className="bg-ink-900 px-5 py-5">
          <p className="font-display text-[15px] leading-snug tracking-wide text-ink-50">
            Rooney Law, P.C.
          </p>
          <div className="mt-2.5 h-px w-8 bg-accent-600" aria-hidden="true" />
          <p className="mt-2.5 text-xs leading-relaxed text-[#B9C4C4]">
            Illinois community associations
            <br />
            Registered-agent market share
          </p>
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
          {/*
            Same rule as the sidebar: no mark below its minimum. The firm name
            in the display face holds the slot until the compact mark is here.
          */}
          <span className="shrink-0 whitespace-nowrap font-display text-xs text-ink-900">
            Rooney Law, P.C.
          </span>
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
