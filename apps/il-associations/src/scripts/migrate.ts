import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";
import { seedReferenceData } from "@/lib/db/seed";
import { bootstrapAdmin } from "@/lib/db/bootstrap";

/**
 * Apply pending migrations, seed reference data, and — on a fresh deployment —
 * create the first administrator from BOOTSTRAP_ADMIN_* variables.
 *
 * This runs before `next start` on every deploy, and every step is idempotent.
 */
async function main(): Promise<void> {
  // Drizzle mutates the client it is handed (it replaces the json/jsonb
  // serializers), so the migrator gets its own and the raw work gets another.
  const migrationClient = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
    const seeded = await seedReferenceData(drizzle(migrationClient));
    console.log(
      `Reference data ready: rule sets ${seeded.ruleSets}, record layouts ${seeded.layouts}.`,
    );
  } finally {
    await migrationClient.end({ timeout: 5 });
  }

  const client = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
  try {
    const result = await bootstrapAdmin(client);
    switch (result.status) {
      case "created":
        console.log(`Created the first administrator: ${result.email}.`);
        console.log("Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now that it is set.");
        break;
      case "reset":
        console.log(`Reset the password for ${result.email} (BOOTSTRAP_ADMIN_FORCE was set).`);
        console.log("Unset BOOTSTRAP_ADMIN_FORCE and BOOTSTRAP_ADMIN_PASSWORD.");
        break;
      case "exists":
        console.log(`Administrator ${result.email} already exists; left untouched.`);
        break;
      case "skipped":
        console.log(`No administrator bootstrap: ${result.reason}.`);
        break;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
