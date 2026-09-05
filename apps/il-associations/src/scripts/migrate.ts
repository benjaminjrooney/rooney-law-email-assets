import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "@/lib/env";
import { seedReferenceData } from "@/lib/db/seed";

/**
 * Apply pending migrations, then seed the reference data an empty database
 * needs: Rule Set v1 and the empty (unconfirmed) record layouts.
 *
 * Safe to run repeatedly — both steps are idempotent.
 */
async function main(): Promise<void> {
  const client = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
    const seeded = await seedReferenceData(drizzle(client));
    console.log(
      `Reference data ready: rule sets ${seeded.ruleSets}, record layouts ${seeded.layouts}.`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
