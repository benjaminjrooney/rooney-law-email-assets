# Rooney Law: mail add-in and public assets

> **The firm's standing rules are in `STANDING-RULES.md` in this repository. Read that
> first.** It covers email, writing, branding, names and contact details, and applies to
> every session on every device.

## About this repository

Two unrelated things: the Word add-in that mails letters through Lob, and the public
email-signature wordmark. See `README.md`.

`rooney-law-wordmark-email-480w.png` is intentionally public so email recipients can
retrieve the logo.

**That question is settled.** The firm's website went live on 6 September 2026 and
serves the same image, byte for byte, at
`https://rooneylawpc.com/.well-known/rooney-law-email-logo.png`. That is the URL the
Brand Guide names, it is on a domain the firm controls, and the site caches
`/.well-known/` for an hour rather than a year so that replacing the logo actually
reaches sent signatures. The Exchange signature rule points there. This copy is retired.

**Retired does not mean deleted. Never delete this file.** A mail client fetches the
image when the recipient opens the message, including mail sent long ago, so removing it
breaks the logo in every email the firm has already sent. It stops being referenced; it
does not stop existing. Do not rename or move it either.

Related: the firm's website lives at `benjaminjrooney/rooney-law-website`. Its
`STATUS.md` is the current state of that project.
