"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui";
import type { ClassificationMode } from "@/lib/queries/filters";

/**
 * Automatic vs Reviewed classification.
 *
 * Every chart, table and export honours this switch, so a reader can always see
 * how much of a figure rests on unreviewed automatic categorisation.
 */
export function ModeToggle({ mode }: { mode: ClassificationMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const select = (next: ClassificationMode) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "effective") params.delete("mode");
    else params.set("mode", next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div
      role="group"
      aria-label="Classification mode"
      className="inline-flex rounded-md ring-1 ring-inset ring-ink-300"
    >
      {(
        [
          ["effective", "Reviewed"],
          ["automatic", "Automatic"],
        ] as const
      ).map(([value, label], index) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => select(value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            index === 0 ? "rounded-l-md" : "rounded-r-md",
            mode === value ? "bg-accent-600 text-white" : "bg-white text-ink-700 hover:bg-ink-50",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
