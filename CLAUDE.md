# Rooney Law: mail add-in and public assets

> **The firm's standing rules are in `STANDING-RULES.md` in this repository. Read that
> first.** It covers email, writing, branding, names and contact details, and applies to
> every session on every device.

## About this repository

Two unrelated things: the Word add-in that mails letters through Lob, and the public
email-signature wordmark. See `README.md`.

`rooney-law-wordmark-email-480w.png` is a public copy of the Rooney Law wordmark.

## What actually uses this file: nothing that has been found

Checked on 6 September 2026, because both this file and `README.md` previously stated
that the firm's email signature points at it. The evidence says otherwise:

- Ben's Outlook signature does **not** reference a hosted URL. It carries the logo as an
  inline attachment, `Outlook-Rooney Law.png`, 21,693 bytes, embedded in each message.
  That is a different derivative again: it matches neither this file (12,074 bytes) nor
  any copy in the website repository.
- No message in the mailbox references `raw.githubusercontent.com` or this filename.
  Both searches returned nothing.
- Nothing in this repository's code references it. Only the prose describing it did.

So there is no "central Exchange signature rule" pointing here, and there may be no
central signature rule at all. The earlier note describing one appears to record an
intention rather than a configuration.

**What this changes.** The claim that deleting this file would break the logo in already
sent mail was wrong: those messages embed their own copy and fetch nothing. That said,
leave the file alone. Its cost is nothing, and "no reference found in the mailbox and
the repository" is not the same as "no reference anywhere": a Word add-in template, a
third-party signature tool, or an older mobile signature could still point at it, and
none of those is visible from here.

**Do not treat any of this as settled without asking Ben.** He is the one who knows
whether a signature service exists.

Related: the firm's website lives at `benjaminjrooney/rooney-law-website`. Its
`STATUS.md` is the current state of that project.
