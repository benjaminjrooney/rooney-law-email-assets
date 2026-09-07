import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from "@/lib/actions/users";
import { currentUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "analyst";
  is_active: boolean;
  last_login_at: string | null;
  password_changed_at: string;
  created_at: string;
};

export default async function UsersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Analysts get sent home rather than shown a page they cannot use.
  if (user.role !== "admin") redirect("/");

  const sql = getSql();
  const users = await sql<UserRow[]>`
    SELECT id, email, display_name, role, is_active, last_login_at, password_changed_at, created_at
    FROM users ORDER BY is_active DESC, lower(email)`;

  const audit = await sql<
    { id: number; actor: string; action: string; note: string | null; created_at: string }[]
  >`
    SELECT id, actor, action, note, created_at FROM audit_log
    WHERE entity_table = 'users' ORDER BY created_at DESC LIMIT 25`;

  const activeAdmins = users.filter((row) => row.role === "admin" && row.is_active).length;
  const when = (value: string | null) =>
    value ? new Date(value).toLocaleDateString("en-US") : "never";

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-normal text-ink-900">Users</h1>

      <Card>
        <CardHeader
          title={`${users.length} account${users.length === 1 ? "" : "s"}`}
          description={`${activeAdmins} active administrator${activeAdmins === 1 ? "" : "s"}. Deactivating an account ends its open sessions immediately.`}
        />
        <Table>
          <thead className="bg-ink-50">
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {users.map((row) => (
              <tr key={row.id} className={row.is_active ? undefined : "bg-ink-50/60"}>
                <Td>
                  <span className="font-medium text-ink-900">{row.display_name}</span>
                  <span className="block text-xs text-ink-500">{row.email}</span>
                  {row.id === user.id ? (
                    <Badge tone="neutral" className="mt-1">
                      you
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  <ActionForm
                    action={setUserRole}
                    submitLabel="Save"
                    variant="ghost"
                    className="space-y-2"
                  >
                    <input type="hidden" name="userId" value={row.id} />
                    <Select name="role" defaultValue={row.role} className="w-32">
                      <option value="admin">Admin</option>
                      <option value="analyst">Analyst</option>
                    </Select>
                  </ActionForm>
                </Td>
                <Td>
                  <Badge tone={row.is_active ? "ok" : "warn"}>
                    {row.is_active ? "active" : "deactivated"}
                  </Badge>
                </Td>
                <Td className="text-xs text-ink-600">
                  {when(row.last_login_at)}
                  <span className="block text-[11px] text-ink-400">
                    password set {when(row.password_changed_at)}
                  </span>
                </Td>
                <Td>
                  <div className="space-y-3">
                    <ActionForm
                      action={setUserActive}
                      submitLabel={row.is_active ? "Deactivate" : "Reactivate"}
                      variant={row.is_active ? "danger" : "secondary"}
                      confirm={
                        row.is_active
                          ? `Deactivate ${row.email}? They will be signed out immediately.`
                          : undefined
                      }
                    >
                      <input type="hidden" name="userId" value={row.id} />
                      <input type="hidden" name="active" value={row.is_active ? "0" : "1"} />
                    </ActionForm>

                    <ActionForm
                      action={resetUserPassword}
                      submitLabel="Reset password"
                      variant="secondary"
                      resetOnSuccess
                    >
                      <input type="hidden" name="userId" value={row.id} />
                      <Input
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="New password"
                        className="w-52"
                        required
                       
                      />
                    </ActionForm>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader
          title="Add someone"
          description="Set a starting password and pass it to them privately. They can change it under Your account."
        />
        <CardBody>
          <ActionForm action={createUser} submitLabel="Create account" resetOnSuccess>
            <Field label="Email address">
              <Input name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Name">
              <Input name="displayName" autoComplete="off" />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="analyst">
                <option value="analyst">Analyst — can read, filter, review and export</option>
                <option value="admin">Admin — can also import and manage users</option>
              </Select>
            </Field>
            <Field label="Starting password">
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                required
               
              />
            </Field>
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recent account activity"
          description="Every account change is recorded here and in the full audit log."
        />
        {audit.length === 0 ? (
          <CardBody className="text-xs text-ink-500">Nothing recorded yet.</CardBody>
        ) : (
          <Table>
            <thead className="bg-ink-50">
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <Td className="text-xs">{new Date(entry.created_at).toLocaleString("en-US")}</Td>
                  <Td className="text-xs">{entry.actor}</Td>
                  <Td className="font-mono text-[11px]">{entry.action}</Td>
                  <Td className="text-xs text-ink-600">{entry.note ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
