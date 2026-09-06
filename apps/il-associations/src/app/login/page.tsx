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
        {/*
          The wordmark, per the Brand Guide.

          240px is the stated screen minimum for the lockup with the tagline,
          and it is measured on the mark, not on a canvas. The approved file is
          padded asymmetrically — 378px of transparent margin on the left of a
          1600px canvas and 17px on the right — so drawing the canvas at 240px
          would have put the mark at 181px, under the minimum and off-centre.
          The copy in src/assets is that file with its fully transparent margin
          trimmed and nothing else touched, so this width is the mark's width.

          The padding is the required clear space: 1/12 of the mark's width,
          20px here, which nothing may enter.
        */}
        <div className="flex justify-center px-5 pb-6 pt-5">
          <Image
            src={wordmark}
            alt="Rooney Law, P.C. — Practical Counsel. Exceptional Results."
            priority
            sizes="240px"
            className="h-auto w-[240px]"
          />
        </div>

        <Card>
          <div className="border-b border-ink-200 px-6 pb-5 pt-5 text-center">
            <h1 className="font-display text-base font-normal text-ink-900">
              Illinois community associations
            </h1>
            <p className="mt-1.5 text-xs text-ink-500">
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
