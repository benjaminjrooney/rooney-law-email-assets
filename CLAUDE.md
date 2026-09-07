# Working agreements for this repository

## Email: use Outlook, never Gmail

**All email to Ben, and all email sent on the firm's behalf, goes through Outlook
(Microsoft 365) — never Gmail.**

- Send with `mcp__Microsoft_365__outlook_send_mail`.
- Ben's address is **brooney@rooneylawpc.com** (Microsoft 365, `Benjamin Rooney`).
  Confirm with `mcp__Microsoft_365__get_me` rather than assuming.
- `benjaminjrooney@gmail.com` is his personal account. Do not send there, and do
  not fall back to it when Outlook errors — report the error instead.

This is a firm matter, not a preference: correspondence from Rooney Law, P.C.
belongs in the firm's mailbox, where it is retained and searchable. A recap that
lands in a personal inbox is outside the firm's records.

The Gmail send, draft, reply and forward tools are denied in
`.claude/settings.json` so the wrong one cannot be reached by accident. Gmail
remains readable, because Ben sometimes asks for something to be found there —
if he asks for reads to stop as well, add the remaining `mcp__Gmail__*` tools to
that deny list.

Outlook's HTML is sanitised on send: headings, paragraphs, lists, tables, links
and basic formatting survive; `<style>`, `<span>`, `<img>` and inline CSS are
stripped. Write semantic HTML and set `bodyType: "html"`, rather than a styled
layout that arrives as a wall of text.
