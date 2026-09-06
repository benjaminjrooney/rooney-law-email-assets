"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn } from "@/components/ui";
import type { ActionResult } from "@/lib/actions/users";

/**
 * A form bound to a server action that reports what happened.
 *
 * Actions here return a result rather than throwing, so a wrong password or a
 * refused deactivation reads as a sentence next to the form instead of an error
 * page.
 */

function SubmitButton({
  children,
  variant = "primary",
  size = "sm",
  confirm,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

export function ActionForm({
  action,
  children,
  submitLabel,
  variant,
  confirm,
  className,
  resetOnSuccess = false,
}: {
  action: (previous: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [result, formAction] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className={cn("space-y-3", className)}
      // Clearing the fields after a successful create keeps the next entry clean
      // and stops a password sitting in the DOM longer than it must.
      key={resetOnSuccess && result?.ok ? "reset" : "form"}
    >
      {children}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant={variant} confirm={confirm}>
          {submitLabel}
        </SubmitButton>

        {result ? (
          <p
            role="status"
            className={cn(
              "text-xs",
              result.ok ? "text-emerald-700" : "text-red-700",
            )}
          >
            {result.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
