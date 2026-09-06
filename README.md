# Rooney Law — mail add-in and public assets

This repository holds two unrelated things: the Word add-in that mails letters
through Lob, and the public email-signature wordmark that predates it.

## Mail via Lob (Word add-in + Railway backend)

Send a physical letter straight from the open Word document — regular,
certified, or certified with return receipt — without touching the Lob
dashboard.

```
apps/word-addin/    Office.js add-in: ribbon button, task pane, auto-extraction
apps/backend/       Express service for Railway: holds the Lob key, calls Lob
docs/               Setup, letter format, and the Centerbase phase-two plan
```

**How it works.** The ribbon button opens a task pane, which reads the open
letter, pre-fills the mail class, recipient, and CC copies from the text, and
exports the document as a PDF. The PDF and the confirmed addresses go to the
Railway service, which holds the Lob API key server-side and creates the letter
through Lob's API. Each CC copy is mailed as its own letter with the same PDF.

The same Railway service also serves the add-in's HTML and JavaScript, so there
is one thing to deploy and one URL to trust.

Around the send itself:

- **Undo.** Lob accepts a cancellation until a letter's `send_date` — five
  minutes after creation by default. The results card shows a live countdown and
  a cancel button per mailing.
- **Address checking.** A button on each recipient runs Lob's USPS verification
  and offers the standardized address rather than rewriting what was typed.
  Needs a live Lob key. `VERIFY_BEFORE_SEND=true` also blocks a send when any
  address is undeliverable, so a bad CC can't leave a half-mailed batch.
- **Delivery tracking.** A signature-verified webhook receiver records Lob's
  tracking events, including the certified ones, and a "Recent mail" panel shows
  the latest status per letter.

- **Setting it up:** [`docs/SETUP.md`](docs/SETUP.md) — Lob keys, Railway
  deployment, building the manifest, sideloading in Word, and going live.
- **What the parser reads:** [`docs/LETTER-FORMAT.md`](docs/LETTER-FORMAT.md).
- **Centerbase billing (not built yet):** [`docs/CENTERBASE.md`](docs/CENTERBASE.md).

```bash
npm install
npm test                                    # backend, parser, and task pane suites
npm run manifest -- --base-url https://<your-app>.up.railway.app
```

Secrets live only in Railway's environment variables — see
[`apps/backend/.env.example`](apps/backend/.env.example). The add-in stores the
service URL and access token in the local browser storage of the machine it runs
on, never inside the document.

## Email signature wordmark

`rooney-law-wordmark-email-480w.png` is the public Rooney Law wordmark. It is
intentionally public so email recipients can retrieve the logo when messages are
received.

### Nothing found in use points at this file

Checked 6 September 2026. Ben's Outlook signature embeds its logo as an inline
attachment (`Outlook-Rooney Law.png`, 21,693 bytes) rather than fetching a hosted
URL. No message in the mailbox references `raw.githubusercontent.com` or this
filename, and no code in this repository references it either.

The firm's website, live since 6 September 2026, serves a copy of the same wordmark
at

    https://rooneylawpc.com/.well-known/rooney-law-email-logo.png

That is the URL the Brand Guide names, on a domain the firm controls, and it is the
right target if a hosted logo is ever wanted. It is byte identical to this file.

Leave this file in place regardless. It costs nothing, and not finding a reference
in the mailbox and this repository is not proof there is none elsewhere.

If the signature is ever pointed back at this file, reference the direct raw HTTPS
file URL, not the GitHub page URL, and do not rename or move the PNG without
updating the central Exchange signature rule first.
