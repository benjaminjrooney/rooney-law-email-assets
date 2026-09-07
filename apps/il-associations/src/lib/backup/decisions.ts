import { getSql } from "@/lib/db";
import { getStorage } from "@/lib/storage";

/**
 * Back up the parts of this database a person made.
 *
 * Nearly everything here regenerates itself: the roster, the agent groups, the
 * automatic categories are all functions of six public files and a rule set,
 * and losing them costs an import. That was proved on the day the volume filled
 * and the fastest way out was to destroy the database and rebuild it, at a cost
 * of half an hour and nothing else.
 *
 * That stops being true the moment somebody reviews an agent. A decision that
 * PAUL HOUILLON and PAUL ANTHONY HOUILLON are one person, or that KSN is a law
 * firm rather than "other", exists nowhere but here and cannot be recomputed
 * from anything. It is also small — a few thousand rows against three million.
 *
 * So this backs up the judgements and skips the derived data:
 *
 *   registered_agent_organizations   only the operator columns
 *   agent_classification_reviews     the review trail
 *   registered_agent_aliases         groupings confirmed by hand
 *   inclusion_rule_sets              rules, which are editable
 *   app_settings                     including the scheduled-refresh URLs
 *   audit_log                        who did what
 *   users                            without password hashes
 *
 * Deliberately not the associations table. Restoring a roster from a backup
 * rather than from the source files would be restoring a copy of something the
 * state publishes, and would go stale the moment it was written.
 *
 * Goes to object storage, never to the database volume — the volume filling is
 * the failure this exists to survive.
 */
export async function backupDecisions(): Promise<{ storageKey: string; byteSize: number }> {
  const sql = getSql();
  const storage = getStorage();

  const agents = await sql`
    SELECT id, grouping_key, canonical_source_name, display_name,
           override_category, override_note, reviewed_by, reviewed_at, merged_into_id
    FROM registered_agent_organizations
    WHERE override_category IS NOT NULL OR reviewed_at IS NOT NULL
       OR merged_into_id IS NOT NULL OR display_name IS NOT NULL`;
  const reviews = await sql`SELECT * FROM agent_classification_reviews`;
  const aliases = await sql`SELECT * FROM registered_agent_aliases`;
  const ruleSets = await sql`SELECT * FROM inclusion_rule_sets`;
  const settings = await sql`SELECT * FROM app_settings`;
  const audit = await sql`SELECT * FROM audit_log ORDER BY id`;
  // No password hashes: a backup should restore who had access, not their
  // credentials. Bootstrap recreates an administrator; the rest are re-invited.
  const users = await sql`SELECT id, email, display_name, role, is_active, created_at FROM users`;
  /*
   * The standings are a measurement of a moment. Next week's files differ, so a
   * week that is lost cannot be recomputed from anything — it is as
   * irreplaceable as a review decision, and more so for the baseline week,
   * which every later comparison is measured against.
   */
  const shareHistory = await sql`
    SELECT import_run_id, captured_at, source_run_date, grouping_key, display_name,
           effective_category, association_count, denominator
    FROM agent_share_history ORDER BY captured_at, id`;

  const bundle = {
    takenAt: new Date().toISOString(),
    note:
      "Operator decisions and the weekly standings. The roster, agent groups and automatic " +
      "categories are derived from the ILSOS files and a rule set; re-import rather than " +
      "restore those. The standings are not derived from anything still obtainable — each is " +
      "a measurement of one week, and next week's files differ.",
    counts: {
      agentsWithDecisions: agents.length,
      reviews: reviews.length,
      aliases: aliases.length,
      ruleSets: ruleSets.length,
      settings: settings.length,
      auditEntries: audit.length,
      users: users.length,
      shareHistoryRows: shareHistory.length,
    },
    agents,
    reviews,
    aliases,
    ruleSets,
    settings,
    audit,
    users,
    shareHistory,
  };

  const body = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
  const key = `backups/decisions-${bundle.takenAt.replace(/[:.]/g, "-")}.json`;
  const stored = await storage.put(key, body);

  console.log(`Backed up to ${stored.storageKey} (${(stored.byteSize / 1024).toFixed(1)} kB)`);
  for (const [what, count] of Object.entries(bundle.counts)) console.log(`  ${what}: ${count}`);
  if (agents.length === 0 && reviews.length === 0) {
    console.log("Nothing decided by hand yet, so this backup is a formality — for now.");
  }
  return stored;
}
