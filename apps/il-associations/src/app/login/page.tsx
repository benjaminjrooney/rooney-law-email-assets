import Image from "next/image";
import { redirect } from "next/navigation";
import { currentUser, signIn, startSession } from "@/lib/auth";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import wordmark from "@/assets/rooney-law-wordmark.png";

export const dynamic = "force-dynamic";

/**
 * Sign-in. The whole application sits behind this page; see src/middleware.ts.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  if (await currentUser()) redirect(params.next || "/");

  async function authenticate(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const next = String(formData.get("next") ?? "") || "/";

    const result = await signIn(email, password);
    if (!result.ok) {
      redirect(`/login?error=${encodeURIComponent(result.message)}&next=${encodeURIComponent(next)}`);
    }
    await startSession(result.user);
    // Only same-origin paths, so a crafted `next` cannot bounce a signed-in
    // session off to another site.
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4">
      <div className="w-full max-w-sm">
        <Card>
          {/*
            The wordmark lives inside the card because the supplied PNG has an
            opaque white background — on the tinted page behind it, it would
            show as a pale rectangle. A transparent PNG or an SVG would let it
            sit anywhere.
          */}
          <div className="flex flex-col items-center border-b border-ink-200 px-6 pb-5 pt-7 text-center">
            <Image src={wordmark} alt="Rooney Law, P.C." priority className="h-auto w-[236px]" />
            <h1 className="mt-5 text-sm font-semibold text-ink-900">
              Illinois community associations
            </h1>
            <p className="mt-1 text-xs text-ink-500">
              Registered-agent market share. Internal tool, authorised users only.
            </p>
          </div>

          <CardBody className="space-y-4 py-5">
            {params.error ? (
              <p
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                {params.error}
              </p>
            ) : null}

            <form action={authenticate} className="space-y-4">
              <input type="hidden" name="next" value={params.next ?? "/"} />
              <Field label="Email address">
                <Input name="email" type="email" autoComplete="username" required autoFocus />
              </Field>
              <Field label="Password">
                <Input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-4 text-center text-xs text-ink-400">
          Need access? Ask an administrator to add you under Users.
        </p>
      </div>
    </main>
  );
}
