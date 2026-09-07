import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { endSession, requireUser } from "@/lib/auth";
import { Button } from "@/components/ui";
import { NavLink } from "@/components/nav-link";
import wordmarkReversed from "@/assets/rooney-law-wordmark-reversed.png";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { href: "/", label: "Dashboard" },
  { href: "/associations", label: "Associations" },
  { href: "/agents", label: "Registered agents" },
  { href: "/market", label: "Market share" },
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
      <aside className="hidden w-72 shrink-0 flex-col border-r border-ink-200 bg-white md:flex">
        {/*
          The reversed wordmark on a charcoal band — the Brand Guide's stated
          use for it, and its approved cross-channel framework.

          The sidebar is 288px so that the mark can be drawn at its 240px
          minimum with the required clear space of 1/12 its width, 20px, on
          every side; px-6 and py-6 give 24px. Nothing enters that margin, which
          is why the heading below sits a further 24px down.

          The mark carries the teal divider itself, so there is no second teal
          rule here. On charcoal, teal is a graphic and not a text colour — it
          measures 2.48:1 — so the line beneath is set in the light neutral the
          guide names for exactly this, at 6.5:1.
        */}
        <div className="bg-ink-900 px-6 py-6">
          <Image
            src={wordmarkReversed}
            alt="Rooney Law, P.C. — Practical Counsel. Exceptional Results."
            priority
            sizes="240px"
            className="h-auto w-[240px]"
          />
          <p className="mt-6 text-xs leading-relaxed text-[#B9C4C4]">
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
        {/*
          Narrow screens. The mark keeps its 240px minimum and its clear space
          on a row of its own; the sections scroll beneath it rather than
          crowding it, because nothing may enter that margin.
        */}
        <div className="border-b border-ink-200 bg-ink-900 px-5 py-5 md:hidden">
          <Image
            src={wordmarkReversed}
            alt="Rooney Law, P.C. — Practical Counsel. Exceptional Results."
            priority
            sizes="240px"
            className="h-auto w-[240px]"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto border-b border-ink-200 bg-white px-3 py-2 md:hidden">
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
