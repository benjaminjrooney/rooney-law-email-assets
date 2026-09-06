import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * A small component kit in the shadcn/ui idiom — composable, unstyled-by-default
 * primitives with Tailwind classes and a `cn` merge helper. Kept local so the
 * app has no runtime dependency on a component registry.
 */

export function cn(...inputs: (string | undefined | null | false)[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------- Button

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 focus-visible:outline-accent-600",
  secondary:
    "bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50 focus-visible:outline-ink-400",
  ghost: "text-ink-700 hover:bg-ink-100 focus-visible:outline-ink-400",
  // A muted brick rather than a pure red: it still reads as "careful" but sits
  // with the wordmark's navy and sage instead of shouting over them.
  danger: "bg-[#9B3F3C] text-white hover:bg-[#853430] focus-visible:outline-[#9B3F3C]",
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  );
}

// ------------------------------------------------------------------ Card

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-ink-200 bg-white shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

// ------------------------------------------------------------------ Stat

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <Card className={cn(tone === "warn" && "border-amber-300 bg-amber-50")}>
      <CardBody className="py-3">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        <p className="tnum mt-1 text-2xl font-semibold text-ink-900">{value}</p>
        {sub ? <p className="tnum mt-0.5 text-xs text-ink-500">{sub}</p> : null}
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------- Badge

type BadgeTone = "neutral" | "law" | "management" | "individual" | "review" | "none" | "warn" | "ok";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  law: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  management: "bg-teal-50 text-teal-700 ring-teal-200",
  individual: "bg-ink-100 text-ink-600 ring-ink-200",
  review: "bg-amber-50 text-amber-800 ring-amber-200",
  none: "bg-ink-50 text-ink-500 ring-ink-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Category colours are consistent everywhere so the eye learns them once. */
export function categoryTone(category: string | null | undefined): BadgeTone {
  switch (category) {
    case "Law firm":
      return "law";
    case "Management company":
      return "management";
    case "Individual / unknown":
      return "individual";
    case "Other organization / review":
      return "review";
    case "No agent record":
      return "none";
    default:
      return "neutral";
  }
}

// ----------------------------------------------------------------- Fields

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-ink-900",
        "ring-1 ring-inset ring-ink-300 placeholder:text-ink-400",
        "focus:ring-2 focus:ring-inset focus:ring-accent-600",
        className,
      )}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "block w-full rounded-md border-0 bg-white px-2.5 py-1.5 text-sm text-ink-900",
        "ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-accent-600",
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">{label}</span>
      {children}
    </label>
  );
}

// ------------------------------------------------------------------ Table

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("min-w-full divide-y divide-ink-200 text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-xs font-semibold text-ink-600",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
  title,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        "px-3 py-2 align-top text-ink-800",
        align === "right" ? "tnum text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ------------------------------------------------------------------ Notes

/**
 * The provisional-classification caveat. Used in several places on purpose: the
 * brief requires the app never to conceal that the first classification pass is
 * automatic and unreviewed.
 */
export function ProvisionalNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900",
        className,
      )}
    >
      <strong className="font-semibold">Provisional classification.</strong> Law-firm and
      management-company categories are assigned by deterministic name rules and have not been
      reviewed unless marked otherwise. Review them before using these figures in a formal market
      analysis.
    </div>
  );
}

export function InclusionCaveat({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600", className)}>
      Legal-name rules are not a perfect proxy for every common-interest community. Some
      associations carry names with none of the Rule Set signals and are absent from this roster;
      some matched entities may not be common-interest communities.
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-ink-500">{children}</div> : null}
    </div>
  );
}

/** Percentages are rounded for display only; exports keep the exact value. */
export function share(value: number | string, decimals = 2): string {
  return `${Number(value).toFixed(decimals)}%`;
}

export function count(value: number | string): string {
  return Number(value).toLocaleString("en-US");
}
