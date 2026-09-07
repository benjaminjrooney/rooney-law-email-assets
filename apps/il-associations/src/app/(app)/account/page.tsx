import { Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { changeOwnPassword } from "@/lib/actions/users";
import { requireUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const sql = getSql();

  const [row] = await sql<
    { last_login_at: string | null; password_changed_at: string; created_at: string }[]
  >`SELECT last_login_at, password_changed_at, created_at FROM users WHERE id = ${user.id}`;

  const when = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString("en-US") : "—";

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="font-display text-xl font-normal text-ink-900">Your account</h1>

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-xs font-medium text-ink-500">Name</dt>
            <dd>{user.displayName}</dd>
            <dt className="text-xs font-medium text-ink-500">Email</dt>
            <dd>{user.email}</dd>
            <dt className="text-xs font-medium text-ink-500">Role</dt>
            <dd className="capitalize">{user.role}</dd>
            <dt className="text-xs font-medium text-ink-500">Last signed in</dt>
            <dd className="text-xs">{when(row?.last_login_at)}</dd>
            <dt className="text-xs font-medium text-ink-500">Password last changed</dt>
            <dd className="text-xs">{when(row?.password_changed_at)}</dd>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Change your password"
          description="Upper and lower case and a digit. Changing it ends every other signed-in session."
        />
        <CardBody>
          <ActionForm action={changeOwnPassword} submitLabel="Change password">
            <Field label="Current password">
              <Input name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password">
              <Input name="newPassword" type="password" autoComplete="new-password" required />
            </Field>
            <Field label="Confirm new password">
              <Input name="confirmPassword" type="password" autoComplete="new-password" required />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
