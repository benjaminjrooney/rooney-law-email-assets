import { closeDb } from "@/lib/db";
import { backupDecisions } from "@/lib/backup/decisions";

/** Run a decisions backup by hand; the weekly refresh runs one on its own. */
backupDecisions()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
