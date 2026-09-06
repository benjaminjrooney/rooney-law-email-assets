# Illinois Community Associations — registered-agent market share

A private, updateable web database of Illinois community associations and the
registered agents who represent them. It imports the Illinois Secretary of
State's Business Data Transparency Act bulk files, identifies community
associations by legal-name rules, groups registered agents, calculates
market share, and exports CSV, Excel and backup bundles.

Internal business-development and market-analysis tool. Everything is behind
authentication.

---

## Read this first: how to read these numbers

**All six record layouts are documented.** Every field position is transcribed
from the Illinois Secretary of State's own publications — "Procedures to Access
Corp Data" and "Procedures to Access LL Data", both v004 (2024-04-04) — carrying
each document's COBOL names and DD numbers, and each layout cites the document it
came from. Nothing rests on inference.

The LLC Name layout was originally derived from 1,494,050 real records before
the documentation was available. The document says the same thing to the
character (`LL-NAME X(120)`, positions 009–128), and it is now seeded from the
document like the rest.

**Entity status is mapped for both families, from separate tables.** Corporation
codes run 00–17 (data element 41006); LLC codes run 00–14 (42010). They are
deliberately not shared, because the same number means different things:

| Code | Corporation | LLC |
|---|---|---|
| 02 | Intent to dissolve | **NGS** (not in good standing) |
| 08 | Dissolved | Voluntary Dissolution/Terminated |
| 11 | Expired | Administratively Dissolved |

Good standing follows each document. The corporation procedures state a rule
outright — `CORP-STATUS < 3`, so codes 00, 01 and 02. The LLC procedures state
none, so the state's own labels decide: 00 Goodstanding and 01 Reinstated,
with 02 excluded because "NGS" is the abbreviation the corporation document
spells out as Not-In-Goodstanding. Sharing one table would have reported LLCs the
state marks not in good standing as active.

A code outside the documented range is still reported as
*"Source code not yet mapped."* rather than guessed at, in case a file carries
one added after these revisions.

**Fields the documents define but this application does not interpret** keep
`role: "unmapped"` with `provenance: "documented"` — the position and source
name are documented, the value simply is not read — and their raw contents are
retained under their own keys. Two are left that way on purpose rather than
plausibly mapped: `CORP-TRANS-DATE` is not read as an effective date, which the
document never calls it, and the agent code is retained but not yet used by
classification.

Two further caveats are stated throughout the UI and in every export, because
they matter to how the numbers should be read:

- **Legal-name rules are not a perfect proxy** for every common-interest
  community. Some associations carry names with none of the Rule Set signals
  and are absent from the roster; some matched entities may not be
  common-interest communities.
- **Automatic agent classification is provisional.** Law-firm and
  management-company categories come from deterministic name rules, not
  judgement. Review them before using the figures in a formal market analysis.

---

## How it works

```
apps/il-associations/
  src/lib/ilsos/      layout registry, fixed-width parser, header checks, column inference
  src/lib/domain/     Rule Set v1, agent normalisation, classification, market-share maths
  src/lib/importer/   staging → join → roster, restart-safe and idempotent
  src/lib/exporter/   streaming CSV, ExcelJS workbook, backup bundle
  src/lib/queries/    filter state and the read models the UI sits on
  src/app/            Next.js App Router pages
  drizzle/            generated SQL migrations
  layouts/            how to transcribe a record layout
```

**Stack.** TypeScript, Next.js (App Router), PostgreSQL, Drizzle ORM, Tailwind
CSS with a local shadcn-style component kit, Recharts, ExcelJS.

### Scheduled refresh

Off unless two switches are both on: `ENABLE_SCHEDULED_REFRESH=true` in the
environment, and the setting under Imports and updates. A recurring import never
starts because someone added a cron entry, or toggled a setting and forgot.

With source URLs saved, the job downloads the files itself into a fresh bundle
and imports it. Without them it falls back to importing an uploaded bundle that
is ready and not yet imported. A family is only refreshed when all three of its
files have a URL — a partial family is skipped rather than half-fetched, because
the importer will not run one anyway.

ILSOS regenerates every file daily and each is a complete snapshot rather than a
set of changes, so any run picks up everything and a missed week costs nothing.

**The archive guard.** Archiving is driven by absence: anything a run does not
touch is marked not current. That is correct when the source file is correct and
catastrophic when it is not — a truncated download, or an error page served in
place of the data, yields no entities and would retire the whole roster while
reporting success. So:

- Matching **nothing at all** is refused for any run, scheduled or manual. It is
  never a real result.
- A **scheduled** run additionally stops if more than half the family would be
  archived. A person can make that change by hand after looking at it; a cron
  cannot look.

Either way nothing is archived and the job exits non-zero, which is what a
scheduler notices. `test/archive-guard.test.ts` covers both limits, the ordinary
churn that must still pass, and the first import into an empty database.

### Getting the files in

Two paths, both on the bundle page.

**Upload** is the primary one: choose the ZIP or TXT and it streams to storage.

**Fetch from a URL** is the alternative, and it exists because these files run to
tens of megabytes — a poor thing to push through a browser on a phone or a slow
line, when the machine running the app can usually reach the publisher directly.
Paste a direct link and the server downloads it. Administrators only, and the URL
is recorded in the audit log, because where a file came from is part of its
provenance.

It is not a scraper: it fetches exactly the URL given, reads no pages and
follows no links. HTTP redirects are followed, but by hand, so each hop is
re-validated rather than trusted.

The guard is the substance of it, since the server is making requests on an
operator's behalf. https only; the host must resolve to a public address;
loopback, private ranges, link-local (including the `169.254.169.254` metadata
endpoint), carrier-grade NAT and IPv4-mapped IPv6 forms are all refused, on the
first URL and on every redirect. The size cap is counted from the stream rather
than read from `Content-Length`, which a server may understate or omit. See
`test/fetch-url.test.ts`.

### The import pipeline

Three restartable phases:

1. **Stage** — each source file is streamed (ZIP or TXT), parsed with its
   confirmed layout, and batched into `staging_records`. Per-file progress is
   recorded, so an interrupted run resumes rather than starting over.
2. **Build** — a family's Name, Agent and Master records are joined *in SQL* on
   the Illinois file number and walked through a server-side cursor. Rule Set
   v1 decides inclusion; matched signals are stored with each record.
3. **Finish** — entities absent from the bundle are archived (soft-deleted,
   history intact) and agent counts are recomputed.

Nothing holds a file in memory. Batches run in transactions.

**Idempotent.** A run's `bundle_digest` is the hash of its six file hashes; a
completed write run with the same digest makes a repeat import a no-op.

**Header and trailer.** A real header reads
`RUN DATE=20260904   FILE:LLC MASTER NAME DATA` — it names the dataset, not the
filename, so the expected text per slot is learned from the first file you
confirm rather than assumed. Until a slot has one, a file is reported but never
rejected. The files also close with a trailer
(`END OF FILE RECORD COUNT= 1494050`); it is skipped rather than loaded as an
entity, and the count it declares is checked against the number of records
actually read, which catches a truncated download.

**Operator work is never overwritten.** The importer's upserts deliberately do
not touch `override_category`, `override_note`, `display_name`, `reviewed_by`
or `reviewed_at`. There's an integration test for exactly this.

### Rule Set v1 — which entities count

An entity is included when its current legal name contains any of:
condominium/condo · townhome/townhouse/town house · homeowner(s)/home owner(s) ·
property owner(s) · community association · residential association · master
association · HOA (including `H.O.A.`) · co-op/coop/cooperative **only when
accompanied by** a housing signal (association, owners, housing, apartments,
residential, community, condominium).

Generic organisations are not swept in by "association" alone, and generic
co-operatives are not swept in by "cooperative" alone. Word boundaries are
respected, so `IDAHOAN FOODS` is not an HOA and `LAWRENCE ANDERSON` is not a law
firm.

Rule sets are versioned rows in `inclusion_rule_sets`, editable and testable
against the current dataset before being activated for a future import.

### Agent grouping

Normalisation is conservative and used **only for grouping**; the exact source
spelling is always preserved separately. It uppercases, expands `&` to `AND`,
removes punctuation, collapses whitespace and strips trailing entity forms, so:

```
COSTELLO SURY & ROONEY, P.C.
COSTELLO SURY & ROONEY PC          →  COSTELLO SURY AND ROONEY
COSTELLO SURY & ROONEY, PC
COSTELLO SURY & ROONEY
```

Two agents group **only** on an exact key match. Similar names are never merged
automatically — merges happen through operator-approved aliases, which are
audit-logged.

### Market share

```
share = associations represented by the agent
        ÷ total qualifying associations in the current filter set
        × 100
```

The denominator is the filter set, never "associations that happen to have an
agent", so category shares plus the "no agent record" share sum to 100%. Exact
values are retained; rounding happens at display time only. Every screen states
its denominator, filters, rule-set version, classification mode, source run
dates and refresh time.

---

## Local setup

Requires Node 20.9+ and PostgreSQL 14+.

```bash
cd apps/il-associations
npm install
cp .env.example .env.local        # then fill in DATABASE_URL and AUTH_SECRET

npm run db:migrate                # applies migrations and seeds Rule Set v1
npm run seed:users -- --email you@example.com --name "Your Name" --role admin
npm run dev                       # http://localhost:3000
```

`db:migrate` is idempotent. It also seeds Rule Set v1 and the six record
layouts — five unconfirmed, plus the LLC Name layout derived from real data.
`seed:users` prints a generated password once if you don't pass `--password`.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:generate` | Regenerate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply migrations, seed rule set and layouts |
| `npm run seed:users -- --email … --role admin` | Create or reset an account |
| `npm run import -- …` | Command-line import (see below) |
| `npm run inspect -- --file …` | Report on a source file without importing it |
| `npm run refresh` | Optional scheduled refresh entry point |
| `npm run lint` / `npm run typecheck` / `npm test` | Checks |

---

## Importing the six source files

The source is the ILSOS **Business Data Transparency Act** portal:
<https://www.ilsos.gov/data/bus-serv-home.html>

| Entity family | Name file | Agent file | Master file |
|---|---|---|---|
| Limited liability companies | `llcallnam` | `llcallagt` | `llcallmst` |
| Corporations and not-for-profits | `cdxallnam` | `cdxallagt` | `cdxallmst` |

Either the `.zip` archives or the extracted `.txt` files are accepted.

There is **no scraper and no automatic download.** The primary path is secure
administrator upload, because the source host blocks programmatic downloads in
some environments — including the one this was built in.

### In the browser

**Imports and updates → New bundle**, then:

1. **Upload** the six files. Each is hashed (SHA-256), its header inspected,
   its run date read, and the bytes stored in object storage. A file whose
   header doesn't carry the expected token is rejected as the wrong file for
   that slot. If no run date can be read, you supply one — it is never guessed.
2. **Confirm each record layout** against the official documentation. The
   observed column boundaries from your own file sit beside the editor as a
   cross-check.
3. **Run a preview** — it reports exactly what would change and writes nothing —
   then **Run import**.

On completion you get inserted / updated / unchanged / archived / excluded /
unmatched / error counts, plus warnings for anything the importer could not
establish.

### From the command line

```bash
npm run import -- --label "September 2026" \
  --llc-name ./llcallnam.zip --llc-agent ./llcallagt.zip --llc-master ./llcallmst.zip \
  --cdx-name ./cdxallnam.zip --cdx-agent ./cdxallagt.zip --cdx-master ./cdxallmst.zip

npm run import -- --bundle 3 --preview     # dry run against an existing bundle
npm run import -- --bundle 3 --resume      # continue an interrupted run
```

### Looking at a file before importing it

`npm run inspect` reads a source file and reports what it finds, without
writing anything and without needing a database:

```bash
npm run inspect -- --file ./llcallnam.zip --family llc --kind name
```

It prints the header and run date, the record and trailer counts, the observed
column boundaries, and — for a Name file — how many entities the active rule set
would qualify, broken down by signal. `--rules <version>` runs a different rule
set, which is how a proposed rule set is tested against the real dataset before
it is activated.

### Validating the first import

Against the September 2026 files under Rule Set v1, expect roughly **33,000**
qualifying associations — about **1,800 LLCs** and **31,000** corporations and
not-for-profit corporations — and a large number of distinct registered-agent
names.

The LLC half of that has been checked against the real file. A September 2026
`llcallnam.txt` holds 1,494,050 entities, of which Rule Set v1 qualifies
**1,782** — against the expected ~1,800:

| Signal | Entities |
|---|---:|
| condo | 577 |
| condominium | 418 |
| townhome / townhouse | 391 |
| homeowner(s) | 165 |
| property owner(s) | 154 |
| community association | 38 |
| HOA | 37 |
| housing co-operative | 5 |
| master association | 1 |

(An entity can match several signals, so these overlap and sum to more than
1,782.)

If your counts are far from expectation, the record layout is the first thing to
re-check: a column boundary off by a few characters truncates names and changes
which entities match.

Do not assume an agent is a management company or a law firm without going
through **Classification review**.

---

## Pages

| Page | What it's for |
|---|---|
| **Your account** | Change your own password. Doing so ends every other signed-in session |
| **Users** (admins) | Add people, set roles, deactivate and reactivate accounts, reset a forgotten password |
| **Dashboard** | Totals, category split, top ten agents, association types, inclusion signals — with the denominator and data currency stated on screen |
| **Associations** | Server-side filtering, sorting and pagination; exact source names and normalised groupings shown separately; per-record provenance and matched signals |
| **Registered agents** | Ranked directory by normalised organisation or exact source name; per-agent share, classification rationale, aliases, address variants, and every entity represented |
| **Classification review** | Queues for `Other organization / review`, low confidence and unreviewed agents; individual or bulk overrides; possible duplicate normalisations |
| **Imports and updates** | The wizard, layout status, run history, and the scheduled-refresh setting |
| **Exports and backups** | CSV, Excel and backup generation, and every previous export with its filter metadata |

An **Automatic / Reviewed** toggle runs through every chart, table and export.

### Accounts

Two roles. **Analysts** read, filter, review classifications and export. **Admins**
also import and manage users.

The session cookie is a signed token, but it is not trusted on its own: every
request re-checks the account against the database. That is what makes
deactivating someone take effect immediately rather than whenever their token
happens to expire, keeps a demoted admin from holding admin powers for the rest
of the day, and voids old sessions the moment a password changes. The last
active administrator cannot be deactivated, demoted or locked out.

### Branding

Everything here comes from the **Rooney Law Brand Kit** in OneDrive
(`Rooney Law/Rooney Law Brand Kit/`), which its own Brand Guide names as
authoritative. `brand.json` there is the single source of truth for colour and
type; this app follows it rather than restating it.

**Colour.** The five brand values are used verbatim and marked `brand` in
`src/app/globals.css`:

| | Hex | Where it lands |
|---|---|---|
| Charcoal | `#2C3A47` | `ink-900` — body type, headings, the sidebar band |
| Teal | `#4A7C7E` | `accent-600` — rules, chart bars, the teal detail |
| Ivory | `#F8F6F2` | `ink-50` — the page ground, reversed type on charcoal |
| Slate | `#69737C` | `ink-500` — secondary type |
| Rule | `#8F999F` | `ink-300` — input borders and button rings |

The Brand Guide specifies no UI ramp, so the remaining steps are tints and
shades of the same two hues, each marked `derived` and carrying its measured
contrast. Two measurements drive real decisions: teal is 4.35:1 on ivory, under
the 4.5:1 small text needs, so links and buttons use a darker derived step at
6.65:1; and teal on charcoal is 2.48:1, which is why the sidebar's teal appears
only as a rule and never as type. Both figures reproduce the Brand Guide's own.

**Type.** Noto Serif for display, Inter for body, per the Typography
Specification, with Georgia and Arial as the fallbacks that document names.
`next/font` fetches them at build time and serves them from this origin, so no
request leaves the browser for a font.

**The mark.** Two approved files are in `src/assets/`, both from the Brand Kit's
`Logos/`: the transparent wordmark (charcoal lettering, teal divider) and the
reversed transparent wordmark (ivory lettering). They appear at **240px**, the
guide's stated screen minimum for the lockup with the tagline, with the required
clear space of 1/12 of the mark's width — 20px — which nothing enters.

- **Login** — the transparent mark, on the ivory field above the card. Its
  default use.
- **Sidebar and the narrow-screen header** — the reversed mark on a charcoal
  band. Its stated use, and the firm's approved cross-channel framework. The
  sidebar is 288px so the mark fits at its minimum with clear space on all
  sides. It carries the teal divider itself, so there is no second teal rule;
  the line beneath is the light neutral the guide names for type on charcoal, at
  6.5:1, because teal on charcoal is 2.48:1 and a graphic rather than a text
  colour.

The copies here are the approved files **with their fully transparent margins
trimmed and nothing else changed** — the trim was verified to drop no pixel with
any alpha at all. It is not cosmetic. The masters are padded asymmetrically:
378px of empty space on the left of a 1600px canvas and 17px on the right, with
the mark itself 1205px. Drawing the canvas at 240px would put the mark at 181px,
under the minimum and visibly off-centre, and would leave 1.4% clear space on
the right where the guide requires 8.3%. Trimming makes a CSS width the mark's
width. OneDrive keeps the untrimmed masters.

**The icon.** `src/app/icon.png` and `src/app/apple-icon.png` are the Brand
Kit's square mark, byte for byte: `rooney-law-favicon-dark-512x512.png` and
`-180x180.png`. Next's file convention picks them up and reads their real
dimensions, so there is no hand-written `icons` entry to drift.

The dark variant, for the reason `brand.json` gives for choosing it as the
Windows icon: it carries its own charcoal ground, so one file reads on light and
dark browser chrome alike. It stays legible down to 32px; at 16px the teal
divider washes out and only the R survives. The kit's dark 16, 32 and 48px files
would be sharper there and lighter to serve, and can be added as `icon1.png` and
`icon2.png` alongside this one.

The icons are named in `src/middleware.ts`'s matcher, because they are routes
like any other. Without that, a signed-out browser asking for the tab icon is
redirected to `/login` and the login page — the one page a signed-out visitor
sees — shows no mark. That was already true of the placeholder that preceded
them.

**Still missing.** One asset: `Logos/email-logo.png`, the compact
`ROONEY | Law, P.C.` mark without the tagline, minimum 120px. Nothing is blocked
on it; it would let the mark appear in slots too small for the full lockup.

---

## Exports

**CSV** — one row per association, streamed, RFC 4180 quoted, UTF-8 BOM so
Excel opens it correctly on Windows.

**Excel `.xlsx`** — `Read Me`, `Summary`, `Agent Market Share`, `Associations`,
`Agent Classification Map`, one worksheet per agent organisation with **two or
more** qualifying associations, `One-Off Agents`, `Worksheet Index`.

Worksheet names respect Excel's 31-character limit, strip the characters Excel
rejects, and never collide — including with the fixed sheet names. Where a
readable name can't be used, a stable code (`A0001`, `A0002`, …) is used and
`Worksheet Index` maps it back to the full organisation name and count. If an
export would produce an impractical number of agent sheets it is split into
alphabetical workbooks plus the full dataset in the first; every agent still
appears in `Worksheet Index`. **No agent is ever silently dropped.**

Frozen headers, autofilters, sensible column widths, and a data bar on market
share. Every export records its filter state, classification mode, rule-set
version, denominator and data-as-of date.

**Backup bundle** — a ZIP holding the normalised CSV, a `metadata.json`
describing exactly how it was produced, and the Excel workbook.

Downloads are streamed through the authenticated app, or redirected to a
short-lived signed URL when the storage driver can issue one.

---

## Deploying to Railway

The app is a Railway service backed by Railway PostgreSQL. From the repository
root:

1. **Create the project and database.** In Railway, create a project, add a
   **PostgreSQL** database, then **New → GitHub Repo** and pick this
   repository.

2. **Point the service at this app.** In the service's **Settings**:

   | Setting | Value |
   |---|---|
   | Root Directory | `apps/il-associations` |
   | Start Command | `npm run db:migrate && npm start` |
   | Healthcheck Path | `/api/health` |
   | Healthcheck Timeout | `300` |
   | Watch Paths | `apps/il-associations/**` |

   That keeps this service separate from the Word add-in backend that also
   lives in this repository, and stops a change to one redeploying the other.

   These live in the service settings rather than a `railway.json`, because
   Railway has deprecated config-as-code in favour of
   [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).
   Leave the build command empty — Nixpacks installs and builds correctly on
   its own, and overriding it with `npm ci` fights its build cache.

3. **Set variables** (Settings → Variables):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` |
   | `AUTH_SECRET` | `openssl rand -base64 48` |
   | `APP_URL` | your service URL |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | your bucket |
   | `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | for S3-compatible providers |

   **The build does not depend on devDependencies.** Railway's service carries
   `NODE_ENV=production`, which makes `npm ci` omit them, and that broke three
   deploys with `Cannot find module '@tailwindcss/postcss'`. Rather than rely on
   a dashboard variable staying deleted, everything `next build` itself needs —
   the Tailwind PostCSS plugin, Tailwind, TypeScript and the `@types` packages —
   sits in `dependencies`. ESLint, Vitest and drizzle-kit stay dev-only.

   That is verifiable rather than hopeful: `npm ci` with dev dependencies
   omitted, then `npm run build`, succeeds. It also means `next build` must not
   typecheck files that import Vitest or drizzle-kit, so `tsconfig.json` covers
   the shipped app and `tsconfig.tools.json` covers the tests, the Vitest config
   and the Drizzle config. `npm run typecheck` runs both, so nothing stops being
   checked.

   The session cookie's `Secure` flag does not depend on NODE_ENV either — it is
   decided by `APP_URL` being https, via `secureCookies()` in `src/lib/env.ts`.

   The build script also empties `.next/cache` first. Turbopack's persistent
   cache is a shared cache mount on Railway and it replayed one genuine failure
   against a later commit that was fine, in three seconds with no recompile;
   clearing the cache and changing nothing else made that same commit build. A
   cold compile takes about six seconds, so the cache was not buying much.

   Object storage is not optional in production: Railway's container
   filesystem is ephemeral, so the `local` driver loses uploaded source files
   and generated exports on every redeploy.

4. **Deploy.** The start command runs `npm run db:migrate` before `npm start`,
   so migrations, reference-data seeding and first-run admin bootstrap happen on
   each deploy. The health check is `/api/health`.

   `tsx` is a runtime dependency, not a dev one, precisely because that start
   command needs it after a production install.

5. **Create the first account.** Set these three variables before the first
   deploy and the migration step creates it for you — no shell needed:

   | Variable | Value |
   |---|---|
   | `BOOTSTRAP_ADMIN_EMAIL` | your email |
   | `BOOTSTRAP_ADMIN_PASSWORD` | 12+ chars, mixed case, a digit |
   | `BOOTSTRAP_ADMIN_NAME` | your name |

   Delete `BOOTSTRAP_ADMIN_PASSWORD` once you have signed in. An account that
   already exists is never silently re-passworded; `BOOTSTRAP_ADMIN_FORCE=true`
   is the deliberate escape hatch for a forgotten password.

   With shell or direct database access you can use `npm run seed:users --
   --email you@example.com --name "Your Name" --role admin` instead.

6. **Keep it private.** There is no public route: `src/middleware.ts` requires
   a session everywhere except `/login` and `/api/health`.

### Optional scheduled refresh — off by default

Recurring imports are **never enabled silently**. Two independent switches must
both be on:

1. `ENABLE_SCHEDULED_REFRESH=true` in the Railway environment, **and**
2. the *Enable scheduled refresh* setting under **Imports and updates**.

Then add a Railway **Cron Schedule** on the service running `npm run refresh` —
`0 6 1 * *` for monthly, `0 6 1 */3 *` for quarterly.

The job does **not** download anything. It imports the newest uploaded bundle
that is ready but not yet imported, so a monthly upload can be picked up
without anyone clicking Import. With either switch off it logs what it would
have needed and exits.

---

## Data model

`source_bundles` · `source_files` · `record_layouts` · `import_runs` ·
`import_file_progress` · `staging_records` · `inclusion_rule_sets` ·
`associations` · `association_snapshots` · `registered_agent_organizations` ·
`registered_agent_aliases` · `agent_classification_reviews` · `import_errors` ·
`export_runs` · `audit_log` · `app_settings` · `users`

`(file_number, entity_family)` is the unique source identity for an
association. Raw source fields are retained as compact JSON on every record for
traceability. Indexes cover name search, agent grouping, category filters,
entity type, rule-set id and import-run id. Every manual edit is audit-logged
with actor, timestamp, affected record and field-level changes.

### Two things worth knowing before you touch the database layer

Both are locked down by tests in `test/db-clients.test.ts`.

- **`getDb()` and `getSql()` use separate clients on purpose.** `drizzle(client)`
  *mutates* the postgres.js client it is handed, replacing the `json`/`jsonb`
  serializers with identity functions. Sharing one client makes every raw
  `sql.json(...)` throw. Never pass the raw client to `drizzle()`.
- **`DATE` columns come back as `YYYY-MM-DD` strings**, via a type override.
  postgres.js otherwise parses them into `Date` objects at UTC midnight, which
  renders as the previous day anywhere west of UTC.

Bind `jsonb` values with `sql.json(...)` or the `jsonParam` helper — never with
`JSON.stringify`, which postgres.js stores as a JSON *string scalar* so
`column->>'key'` silently comes back null.

---

## Tests

```bash
npm test          # unit suites
npm run lint
npm run typecheck

# with a database, the integration suites run too:
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/il_assoc_test npm test
```

The integration suites drop and recreate the database named in
`TEST_DATABASE_URL`; point it somewhere disposable. Without it they skip, so
`npm test` stays green on a machine with no database.

Covered: fixed-width parsing (including byte alignment, chunk-boundary
reassembly and headerless fixed-length files), header validation and file-type
rejection, layout validation, column inference, Rule Set v1 matching and its
false-positive guards, agent normalisation, classification, market-share
arithmetic, duplicate prevention, import idempotency, override preservation,
Excel worksheet routing and naming, and workbook segmentation. The Excel test
generates a real workbook and reads it back.

Fixtures are small and synthetic — the official datasets are never committed,
and neither are the fixture layouts' positions, which are invented shapes used
only to exercise the parser.

## What is not committed

Credentials, database dumps, and raw Illinois bulk files. Source files live in
object storage; secrets live in Railway's environment variables.
