import { closeDb, getSql } from "@/lib/db";
import { ENTITY_FAMILIES, FILE_KINDS, PUBLISHED_SOURCE_URLS } from "@/lib/ilsos/layout";
import { assertFetchableUrl } from "@/lib/importer/fetch-url";

/**
 * Write the scheduled-refresh configuration from the command line.
 *
 * The same thing an administrator does on the Imports and updates page, for
 * when reaching that page is the hard part — a first run before anyone has
 * signed in, a rebuild from an empty database, or an operator who has the
 * Railway console but not the application.
 *
 *   npm run configure:refresh -- --cadence weekly --enable
 *   npm run configure:refresh -- --disable
 *
 * Source URLs default to where the Secretary of State publishes each file.
 * Pass --sources none to leave them empty, in which case the job falls back to
 * importing a bundle somebody uploaded.
 *
 * This does not import anything. It writes a setting; `npm run refresh` acts on
 * it. Enabling here still leaves ENABLE_SCHEDULED_REFRESH as the second switch,
 * so a schedule cannot start from this alone.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };

  const enable = args.includes("--enable");
  const disable = args.includes("--disable");
  if (enable && disable) throw new Error("Pass --enable or --disable, not both.");
  if (!enable && !disable) throw new Error("Pass --enable or --disable.");

  const cadence = flag("cadence") ?? "weekly";
  if (!["weekly", "monthly", "quarterly"].includes(cadence)) {
    throw new Error(`Unknown cadence "${cadence}". Use weekly, monthly or quarterly.`);
  }

  const sources: Record<string, string> = {};
  if (flag("sources") !== "none") {
    for (const family of ENTITY_FAMILIES) {
      for (const kind of FILE_KINDS) {
        const url = PUBLISHED_SOURCE_URLS[family][kind];
        // The same check the importer applies before downloading.
        await assertFetchableUrl(url);
        sources[`${family}-${kind}`] = url;
      }
    }
  }

  const sql = getSql();
  const value = { enabled: enable, cadence, sources };

  await sql`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES ('scheduled_refresh', ${sql.json(value as never)}, 'configure-refresh (cli)')
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;

  await sql`
    INSERT INTO audit_log (actor, action, entity_table, entity_id, note)
    VALUES ('configure-refresh (cli)',
            ${enable ? "settings.scheduled_refresh_enabled" : "settings.scheduled_refresh_disabled"},
            'app_settings', 'scheduled_refresh',
            ${`${cadence}; ${Object.keys(sources).length} source URLs`})`;

  console.log(
    `Scheduled refresh ${enable ? "enabled" : "disabled"} (${cadence}), ` +
      `${Object.keys(sources).length} source URLs saved.`,
  );
  for (const [key, url] of Object.entries(sources)) console.log(`  ${key} → ${url}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
