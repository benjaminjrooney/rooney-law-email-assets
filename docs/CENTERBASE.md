# Phase two: logging postage to Centerbase

Not built yet. This is the plan and the groundwork already in place, so the
billing step can be added without reworking the send flow.

## What it should do

After a letter is mailed, the task pane asks which client or matter it belongs
to and posts the postage as a billed expense in Centerbase, so the cost lands on
the next invoice instead of being reconstructed from Lob statements later.

```
task pane ──► POST /api/letters ──► Lob            (built)
     │
     └──────► POST /api/expenses ──► Centerbase    (phase two)
```

Keeping it a second call matters: mailing is the part that must not fail, and a
Centerbase outage should never block or duplicate a letter. A letter that mailed
but failed to post its expense is a retry, not a re-send.

## Groundwork already in the code

- **Every mailing returns a Lob letter ID** (`mailings[].letter.id`), plus mail
  class, recipient, tracking number, and expected delivery date. That is the
  natural key and description text for the expense entry.
- **Metadata rides along.** The add-in already sends `metadata.source` and, when
  the letter has a `Re:` line, `metadata.subject`. Lob stores metadata on the
  letter, so once a Centerbase matter is chosen it can be written there too
  (`metadata.matter`) and the two systems stay reconcilable.
- **The parser extracts the `Re:` line**, which in practice usually names the
  matter — good enough to pre-select a matter in a picker, subject to
  confirmation.
- **The backend already brokers a secret.** A Centerbase credential is one more
  server-side environment variable and one more small client module beside
  `apps/backend/src/lob.js`; nothing about it needs to reach Word.
- **The amount is already calculated.** Every send returns a per-letter
  `estimate` (with a breakdown) and a `total`, and `POST /api/estimate` prices a
  send without creating anything. The expense entry has a number to post.
- **Letters can already be tagged for invoicing.** `billingGroupId` is passed
  through to Lob, so once a matter is chosen it can group the letter on the Lob
  invoice as well as in Centerbase.

## What to settle before building

1. **API shape.** Centerbase publishes a developer API through its support
   portal (Settings → Developer's API in the Centerbase admin). Confirm from the
   firm's own account: authentication (API key vs. OAuth), the base URL, and the
   object name for a cost/expense entry, since Centerbase models records as
   configurable objects rather than fixed REST resources.
2. ~~**Where the amount comes from.**~~ **Settled.** Verified against Lob's
   OpenAPI spec: there is no price field on the letter object in any variant, no
   pricing or invoice endpoint, and `billing_groups` carries only labels. The
   amount therefore comes from the price table now built into the service
   (`apps/backend/src/pricing.js`, rates in `RATE_*` environment variables), and
   every send already returns a per-letter `estimate` and a `total`. That is
   what the expense entry should post.

   Because it is an estimate, letters also accept a `billingGroupId` that is
   passed through to Lob, so the monthly invoice breaks down by client or matter
   and can be reconciled against the letter IDs recorded here.
3. **Matter selection.** Whether to fetch the matter list from Centerbase live
   (needs a search endpoint and caching) or let the user type a matter number
   that the server validates.
4. **Expense code.** Which Centerbase expense/cost code postage should use, and
   whether certified and regular mail are separate codes.
5. **Failure handling.** Where a failed expense post is queued for retry. An
   in-memory queue is lost on a Railway restart; a small persisted table (Railway
   Postgres) is the durable option if the firm cares about never losing one.

## Suggested slice

1. `POST /api/expenses` on the backend: takes a letter ID, a matter, and a mail
   class; looks up the price from config; posts to Centerbase; returns the
   created expense ID.
2. A "Bill this to…" step in the task pane's results card, shown once a letter
   sends, with the matter pre-selected from the `Re:` line.
3. Write the matter back to the Lob letter's metadata so the two records point at
   each other.
4. A reconciliation script that lists letters mailed in a period and flags any
   without a Centerbase expense.

Steps 1 and 2 make the flow usable; 3 and 4 are what make it auditable at the end
of the month.
