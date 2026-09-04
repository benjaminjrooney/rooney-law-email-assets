# Setup: mailing letters from Word through Lob

How the pieces fit together:

```
Word (desktop)                Railway                        Lob
┌────────────────────┐        ┌──────────────────────┐       ┌──────────────────┐
│ "Mail via Lob"     │  PDF   │ POST /api/letters    │  PDF  │ POST /v1/letters │
│ ribbon button      │ ─────► │ holds the Lob key    │ ────► │ prints and mails │
│ task pane          │ ◄───── │ validates addresses  │ ◄──── │ tracking number  │
└────────────────────┘ result └──────────────────────┘       └──────────────────┘
```

The Lob API key lives only in Railway's environment variables. The add-in never
sees it; it authenticates to the Railway service with a separate shared token.

---

## 1. Get the Lob keys

In the [Lob dashboard](https://dashboard.lob.com) under **Settings → API keys**
there are two secret keys:

| Key | What it does |
| --- | --- |
| `test_...` | Creates letters and returns real-looking responses. Nothing is printed or mailed. Free. |
| `live_...` | Prints and mails for real. Billed to the firm. |

Start with the test key. Also check **Settings → Account** for the mail
strictness setting: Lob refuses addresses that fail verification at the level
set there, and the add-in surfaces that refusal as an error on the recipient.

## 2. Deploy the backend to Railway

1. In Railway, **New Project → Deploy from GitHub repo** and pick this
   repository. Leave the root directory at the repository root — `railway.json`
   and the root `package.json` drive the build (`npm ci`, then `npm start`).
2. Add the environment variables from [`apps/backend/.env.example`](../apps/backend/.env.example).
   At a minimum:

   ```
   LOB_API_KEY=test_...
   API_TOKEN=<a long random string>
   RETURN_NAME=Benjamin J. Rooney
   RETURN_COMPANY=Rooney Law
   RETURN_ADDRESS_LINE1=...
   RETURN_ADDRESS_CITY=...
   RETURN_ADDRESS_STATE=IL
   RETURN_ADDRESS_ZIP=...
   ```

   Generate the token with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

3. Under **Settings → Networking**, generate a public domain. That URL — for
   example `https://rooney-mail.up.railway.app` — is the base URL everywhere below.
4. Check the deploy:

   ```bash
   curl https://rooney-mail.up.railway.app/healthz
   ```

   `{"ok":true, ...}` means the service is configured. If `ok` is false, the
   `problems` array names each missing variable. `/health` is an alias for the
   same check, so either path works — point an uptime monitor at whichever one
   it defaults to.

## 3. Build the manifest

The manifest tells Word where the add-in lives, so it has to carry the Railway
URL:

```bash
npm install
npm run manifest -- --base-url https://rooney-mail.up.railway.app
```

That writes `apps/word-addin/build/manifest.xml`. Keep that file — the add-in ID
inside it must stay the same across rebuilds, and the script reuses the existing
ID automatically when you re-run it.

## 4. Sideload the add-in in Word

**Word for Windows**

1. Put `manifest.xml` in a folder you can share, e.g. `C:\WordAddins`, and share
   that folder (right-click → Properties → Sharing) so it has a UNC path such as
   `\\YOURPC\WordAddins`.
2. Word → **File → Options → Trust Center → Trust Center Settings → Trusted
   Add-in Catalogs**. Paste the UNC path, click **Add catalog**, tick **Show in
   Menu**, then OK.
3. Restart Word. **Insert → My Add-ins → Shared Folder → Mail via Lob**.

**Word for Mac**

1. Copy `manifest.xml` into
   `~/Library/Containers/com.microsoft.Word/Data/Documents/wef`
   (create the `wef` folder if it does not exist).
2. Restart Word. **Insert → Add-ins → My Add-ins → Mail via Lob**.

**Word on the web** — the add-in loads (**Home → Add-ins → Upload My Add-in**),
but Word on the web cannot export a PDF from an add-in, so sending is blocked
there. The task pane says so when it detects that host. Use the desktop app to
send.

Once loaded, the **Mail via Lob** button sits on the Home tab.

## 5. First send

1. Open a letter and click **Mail via Lob**.
2. The first time only, paste the service address (the Railway URL) and the
   `API_TOKEN`. They are stored in this computer's browser storage — never in
   the document, so a token cannot travel inside a `.docx` you send to someone.
3. The pane reads the letter and pre-fills the mail class, the recipient, and
   any CC copies. Check them.
4. **Send letter** asks for a confirmation, then exports the PDF and sends it.
5. With a test key, the letters appear in the Lob dashboard's test mode and the
   task pane shows each Lob ID and the proof PDF link. Open the proof and check
   the address block and page breaks before going live.

## 6. Go live

Swap `LOB_API_KEY` in Railway to the `live_...` key and redeploy. The task pane
badge turns from *test mode* to *live postage*, and the confirmation step warns
that postage will be charged.

## 7. Delivery tracking (optional, recommended for certified)

Lob reports delivery progress by webhook. Without this the add-in still mails
letters and returns tracking numbers — you just have to check the Lob dashboard
to learn what happened to them.

1. In the Lob dashboard, **Webhooks → Create webhook**.
2. URL: `https://rooney-mail.up.railway.app/webhooks/lob`
3. Subscribe to the letter events you care about. The useful ones are
   `letter.mailed`, `letter.processed_for_delivery`, `letter.delivered`,
   `letter.returned_to_sender`, and the certified equivalents
   (`letter.certified.delivered`, `letter.certified.pickup_available`,
   `letter.certified.returned_to_sender`, `letter.certified.issue`).
4. Copy the webhook's signing secret into `LOB_WEBHOOK_SECRET` in Railway.
5. Create the same webhook in both Test and Live environments if you want it to
   work in both — Lob keeps them separate.

Every delivery is authenticated by its `Lob-Signature` header, an HMAC of the
timestamp and the exact request body. Deliveries that are unsigned, wrongly
signed, or more than five minutes old are refused, so the endpoint is safe to
expose without the add-in's token (Lob cannot send one).

### Keeping tracking history across restarts

By default events are held in memory only, so every deploy empties the **Recent
mail** panel — the letters are unaffected and Lob still has the full history, but
the firm's own trail starts over. Attach a volume to keep it:

1. Open the project **canvas** (the view with the service card) and choose
   **+ Add → Volume**. Volumes are managed on the canvas, where they appear as
   their own node wired to the service — there is no "Volumes" section under the
   service's Settings tab.
2. Attach it to `mail-service` with mount path `/data`.
3. Add the variable `EVENT_LOG_PATH=/data/lob-events.jsonl`.
4. **Apply the staged changes.** A banner reading **"Apply N changes"** appears at
   the top of the canvas with a **Deploy** button. Volume changes are staged, not
   live, and *nothing mounts until that button is pressed* — redeploying the
   service does not substitute for it. Press **Details** first and check the list
   is only volume and mount-path entries.

Each event is appended as one JSON line. At startup the service reads the tail of
that file back, so the panel survives deploys and crashes. The file is only ever
appended to; the directory is created if the volume is empty.

The `server.started` line is the authority on whether it worked:

- `"eventLog": "/data/lob-events.jsonl"` — mounted, history is durable.
- `"eventLog": "… (NOT on a volume — lost on restart)"` — the path exists but is
  ordinary container storage. The variable is set and the volume is probably
  staged but never applied; go back to step 4.

Do not trust the Railway API's `volumeMounts` on its own. It reports a mount as
configured while `hasVolume` is still false and nothing is bound in the
container — the startup line reads the running filesystem and is the one that
matters.

Create the volume at its final size in one step. Resizing a volume that has never
been mounted has been observed to leave it configured but permanently unbindable;
the fix is to delete it and create a new one.

Because it is never rotated, only the last few megabytes are read at boot, which
is far more than `EVENT_MAX_RETAINED` needs. A half-written final line from a
crash is skipped rather than discarding the rest.

The task pane's **Recent mail** section lists recent letters from Lob with the
latest status for each.

## 8. Canceling a letter

Lob accepts a cancellation until the letter's `send_date` — five minutes after
creation on a default account, and free of charge. The results card shows a live
countdown and a **Cancel this letter** button for each mailing; after the window
closes the button reports that the letter has gone to print.

The countdown is driven by the `send_date` Lob returns, so if the firm's
cancellation window is ever changed in the Lob dashboard, the pane follows it
without a code change.

## 9. Checking addresses

**This needs a live Lob key.** On a test key Lob validates the request but
returns an empty result, so the button in the task pane says so rather than
pretending the address is bad.

**Check this address with USPS** under the recipient (and under each copy) runs
Lob's US verification and reports one of: deliverable, deliverable but the
suite/unit is unnecessary, incorrect, or missing, or undeliverable. When USPS
standardizes the address, the pane shows what it would become and offers **Use
the USPS version** — it never rewrites what was typed on its own.

Each check is a billable Lob lookup, which is why it is a button rather than
something that runs on every keystroke. Setting `VERIFY_BEFORE_SEND=true` also
checks every recipient during a send and refuses the whole batch if any address
is undeliverable — nothing is mailed, so a bad CC cannot leave you with a
half-sent letter. If the verification service itself is down, the send proceeds
and Lob's own validation at creation time still applies.

## 10. Postage cost (optional)

**Lob's API does not return what a letter cost.** There is no price field on the
letter object and no pricing endpoint — `billing_groups` carries only labels,
and `/accounts/credits_balance` is an account-level figure. So the cost shown
before sending is worked out on the server from rates you supply.

Those rates ship blank on purpose. Lob does not publish a fixed price list;
per-piece pricing depends on the account's Print & Mail Edition and volume. With
`RATE_BASE` unset, no cost appears anywhere — which is the right behaviour,
because a plausible-looking guess would end up on a client's invoice.

To turn it on, take the real numbers off a Lob invoice or the pricing page in
the dashboard and set them in Railway:

```
RATE_BASE=                       # one-page black-and-white first-class letter
RATE_EXTRA_PAGE=                 # each page beyond the first
RATE_CERTIFIED=
RATE_CERTIFIED_RETURN_RECEIPT=
RATE_REGISTERED=
```

Then the confirm step shows the page count, a per-letter cost, and the total
before anything is sent. The estimate accounts for the address page Lob inserts,
and does not charge for the cover sheet Lob adds to certified mail (Lob states
that sheet is free). If a rate is missing for the class being sent — certified,
say — the estimate is withheld rather than quoted low.

For reference, USPS's own certified fee was $5.55 and the electronic return
receipt $2.91 as of July 2026 ([USPS certified mail
costs](https://www.postgrid.com/usps-certified-mail-costs-rates/)) — but what
Lob charges the firm is what belongs in the config.

**Every figure is an estimate.** Reconcile against the Lob invoice; setting a
`billingGroupId` per client or matter (passed through to Lob) makes that
reconciliation straightforward. See [`docs/CENTERBASE.md`](CENTERBASE.md).

---

## Where the address block goes

Lob prints the recipient address so it shows through the envelope window. Two
settings matter, and the default is deliberate:

- **`insert_blank_page` (default)** — Lob adds a separate address page in front
  of the letter. Nothing is printed over the letterhead. Costs one extra printed
  page per letter.
- **`top_first_page`** — Lob prints the address over the top of page 1. Only use
  this if the letter template leaves roughly the top 2.5 inches blank; otherwise
  it prints on top of the letterhead.

Certified and registered mail ignore this setting: Lob adds its own cover sheet
carrying the address and barcode, at no extra charge.

## Mail classes

| Task pane label | Lob parameters | Notes |
| --- | --- | --- |
| Regular mail (First-Class) | `mail_type=usps_first_class` | No tracking. |
| Certified mail | `extra_service=certified` | Tracking number returned; extra cover sheet added by Lob. |
| Certified mail, return receipt requested | `extra_service=certified_return_receipt` | Adds the electronic signature receipt. |
| Registered mail | `extra_service=registered` | For international destinations. |

Marketing-class mail (`usps_standard`) is deliberately not offered: it is the
wrong USPS use type for legal correspondence.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Task pane says the token was rejected | `API_TOKEN` in Railway does not match what was pasted into the pane. Re-enter it under *Return address and print options → Change service settings*. |
| "Word on the web cannot export a PDF" | Expected. Open the document in Word for Windows or Mac. |
| Lob error about the recipient address | Lob verifies US addresses and refuses undeliverable ones. Correct the address in the pane and send again — nothing was mailed. |
| "This document is about N pages" | Lob caps letters at 60 pages single-sided (120 double-sided). |
| "Hourly limit reached" | The spend guardrail (`MAX_LETTERS_PER_HOUR`) stopped the request. Raise it in Railway if the firm genuinely sends more. |
| A CC copy failed but the main letter went | The response lists each mailing separately. Fix that address and send only that copy — re-sending the whole letter would mail the addressee twice. |
| Nothing happens when the ribbon button is clicked | The manifest points at a URL Word cannot reach. Open the Railway URL in a browser; check `/addin/taskpane.html` loads. |
| "Address check needs a live Lob key" | Expected on a `test_` key — Lob returns no verification data there. |
| Cancel says the letter can no longer be canceled | The `send_date` has passed; Lob has sent it to print. Nothing can pull it back. |
| Recent mail shows no statuses | `LOB_WEBHOOK_SECRET` is unset, or the webhook was created in the other Lob environment (test vs. live). Check the Railway logs for `webhook.rejected`. |
| Webhook deliveries fail in the Lob dashboard | A 401 means the signature or timestamp did not check out — usually the wrong secret. A 503 means `LOB_WEBHOOK_SECRET` is not set on the service. |

## Local development

```bash
npm install
npm test                 # backend, parser, and task pane tests

# run the service locally
LOB_API_KEY=test_... API_TOKEN=dev-token-dev-token-dev-token \
RETURN_NAME="Benjamin J. Rooney" RETURN_ADDRESS_LINE1="..." \
RETURN_ADDRESS_CITY=Chicago RETURN_ADDRESS_STATE=IL RETURN_ADDRESS_ZIP=60602 \
npm run dev
```

The task pane is then at `http://localhost:3000/addin/taskpane.html`. Word only
loads add-ins over HTTPS, so for in-Word testing point the manifest at the
Railway deployment rather than localhost.

The task pane tests drive the real page in headless Chromium with a stubbed
Office.js. Playwright is not a dependency of this repo — those two tests skip
themselves unless it is installed, so a plain `npm install` stays small:

```bash
npm install --no-save playwright && npx playwright install chromium
npm test        # now runs the task pane tests too
```

If the machine already has a Chromium, point at it with `CHROMIUM_PATH=/path/to/chrome`
instead of downloading another.
