# Rooney Law: mail add-in and public assets

> **The firm's standing rules are in `STANDING-RULES.md` in this repository. Read that
> first.** It covers email, writing, branding, names and contact details, and applies to
> every session on every device.

## About this repository

Two unrelated things: the Word add-in that mails letters through Lob, and the public
email-signature wordmark. See `README.md`.

`rooney-law-wordmark-email-480w.png` is a public copy of the Rooney Law wordmark.

## The signature embeds its logo. Leave it that way.

Established 6 September 2026 by opening a sent message and by Ben confirming the setup.

There is no central signature rule and no Exchange console involved. A transport rule
could not produce what is actually in the mail: a transport disclaimer can only inject
HTML and must fetch any image from a URL, and Ben's logo is an inline attachment,
`Outlook-Rooney Law.png`, 21,693 bytes, embedded in each message. One signature lives in
the mailbox, Outlook on the web holds it, and the phone is set to "use my signature from
Outlook on the web". Ben maintains it by pasting.

The embedded image was checked and is the approved wordmark: charcoal ROONEY, teal
"Practical Counsel. Exceptional Results." It is a different export size from every copy
in git, but it is the right mark.

**Do not move this to a hosted URL.** The earlier plan was to point the signature at
`rooneylawpc.com/.well-known/rooney-law-email-logo.png`. That is the wrong trade for a
law firm:

- An embedded image renders without the recipient approving remote content. A hosted one
  is blocked by default in a good number of clients, so the logo silently does not
  appear, which looks worse than the 23KB the attachment costs.
- A hosted logo makes every opened email a request to the firm's own server. That is an
  open-tracking signal attached to privileged correspondence, for no benefit.

The only thing a hosted logo buys is changing the mark in already-sent mail, which is
not something the firm needs.

The website still serves the file at that URL. It is live, correct, cached for an hour
rather than a year, and available if the position ever changes. Nothing points at it
today, and nothing should.

## This file

Nothing found in use references it. No message in the mailbox mentions
`raw.githubusercontent.com` or this filename, and no code in this repository references
it. Leave it in place anyway: it costs nothing, and not finding a reference in the
mailbox and this repository is not proof there is none in a Word add-in template or an
older signature somewhere.

Related: the firm's website lives at `benjaminjrooney/rooney-law-website`. Its
`STATUS.md` is the current state of that project.
