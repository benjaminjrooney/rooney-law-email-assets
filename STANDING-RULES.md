# Rooney Law: standing rules for any Claude session

**Read this before writing anything for Ben, including chat messages, not only
documents.** These are standing rules, not preferences, and several of them have been
broken before by sessions that never saw them.

Canonical copy: `OneDrive - Rooney Law\Rooney Law\CLAUDE.md`. Copies live in each
repository so a session with no OneDrive access still gets them. If they disagree, the
OneDrive copy is right.

Last amended 6 September 2026.

---

## 1. Email

### 1.1 Which account

When Ben says "email" without specifying, he means his **Outlook (Rooney Law, P.C.)**
account. Use Gmail only when he says Gmail.

### 1.2 Never send without approval, with one exception

**Default, no exceptions: never send an email on Ben's behalf.** Draft it, show him the
full contents on screen, and wait for his explicit approval. Urgency is never a reason
to skip this. Broken 2026-09-03 (a cancellation sent to Bryan Barus without review) and
again 2026-09-06 (a status email sent to Ben's Gmail without review, on the wrong
account).

**The one exception, added 6 September 2026.** An email may be sent without a separate
approval step when **both** of these hold:

1. Ben asked for the email in that session, and
2. **every** recipient, across To, Cc and Bcc, is Ben himself or an address at
   `@rooneylawpc.com`.

A single recipient outside `@rooneylawpc.com` anywhere on the message removes the
exception. Draft it and wait.

When in doubt, draft it. Showing him a draft he did not need costs nothing. Sending one
he did need to see is the failure this rule exists to prevent.

### 1.3 Signature on Outlook mail

Every email sent from the Outlook (Rooney Law, P.C.) account carries his signature,
appended after the "Thanks," sign-off. Outlook's own auto-signature only applies inside
the Outlook app, not to mail sent through the API, so it has to be added to the body
every time.

The Outlook API strips inline styling: no `style=`, `class=` or `id=`, no colours, fonts
or table layout. The styled version cannot be reproduced. Use this block, in HTML using
only `p`, `br`, `b` and `a` tags:

```
BEN ROONEY
ATTORNEY AT LAW | 217 South Third Street, Geneva, Illinois 60134

Tel: 331.265.7775
Email: brooney@rooneylawpc.com
LinkedIn: Follow Rooney Law, P.C. (links to https://www.linkedin.com/company/rooney-law-pc/)

CONFIDENTIALITY NOTICE: This email and any attachments may contain confidential or
privileged information intended only for the named recipient(s). If received in error,
please notify the sender, do not review, copy, or distribute it, and delete it.
```

This does not apply to his Gmail account unless he says otherwise.

---

## 2. Writing

### 2.1 Hard rules, every document, every draft, every chat message

- **Never use em dashes at all.** Use commas, semicolons, colons, parentheses, or split
  the sentence.
- **Never write "I want to be clear"** or its variants: "to be clear", "I want to be
  direct", "I want to be candid", "let me be clear".
- **Nothing may read as though it came from an AI.**

Ben was emphatic about all three. The em dash rule was broken repeatedly on 2026-08-30
while it was already recorded.

### 2.2 AI tells to avoid

Em dashes as an all-purpose connector. "I want to be clear / direct / candid". The
"It's not X, it's Y" antithesis, and the related "not just X, but Y". Rule-of-three
lists used for rhythm. "It's worth noting", "Importantly", "Notably", "That said".
Reassurance-then-pivot openers. Sentences that restate the point just made. The words
delve, leverage, robust, landscape, navigate, underscore, testament, pivotal. Stacked
hedges.

Write it the way a practicing lawyer writes it.

---

## 3. How Ben wants to be worked with

### 3.1 Do it yourself

Only hand a task back to Ben when doing so is genuinely faster, or when it involves a
credential or another security concern. Exhaust your own access first, including every
connector, before asking.

Specifically on Brand Kit maintenance (retiring superseded files, rebuilding, audits):
do not hand him a list of menu options to run. Run them and report what came back. His
words: "you just make that part of your process so I don't have to keep running that
brand command."

### 3.2 Always include the link

Every request to do something on a website carries the actual clickable URL, every time.
Not the name of the page, not a path through a menu on its own. He closes windows fast
and does not want to hunt for the page again.

### 3.3 Full instructions, never a fragment

When asked to modify or update an existing set of instructions or a prompt, output the
**full** instructions with only the discussed changes applied and everything else
intact. Never a partial snippet he has to merge in himself.

---

## 4. Branding and documents

### 4.1 Never recreate the branding

**Never construct, approximate, or recreate Rooney Law letterhead, logos, or firm
branding from a description or from remembered brand facts.** Use only the actual
template file.

If the real template is not available in the session, build the document body with **no
header at all** and say so plainly on delivery. Do not synthesise something that looks
like letterhead.

Broken 2026-09-03: a session read the text of `Generated\Letter.docx` through the
SharePoint connector, then fabricated a lookalike letterhead and signature block in a
fresh python-docx file. The fix is to request the device folder
(`Rooney Law\Rooney Law Brand Kit`) and build on the actual `Generated\Letter.docx`, or
hand the draft back with no header and say so.

### 4.2 The Brand Kit is the authority

`OneDrive - Rooney Law\Rooney Law\Rooney Law Brand Kit\Brand Guide.md` holds the numbers
and the reasoning. `Approved Asset Index.md` says which file to open: if a file is not
listed there, it is not the approved version. Never infer a brand rule from what an
existing document or the website currently does.

### 4.3 Letters

- The template is `Rooney Law\Rooney Law Brand Kit\Generated\Letter.docx`. Open it and
  type. Do not start from the letterhead, which is deliberately empty stationery, and do
  not use the old `BJR Letter Template` files, which carry the retired long closing
  block.
- **Letters are dated the day they are generated**, not a future or estimated send date,
  unless Ben says otherwise.
- Letterhead prints on page one only. Page two onward carries a one-line continuation
  header: `[Recipient] · [Date] · Page N`, with N as a live PAGE field.
- The closing block is name and title only. No contact details.
- Send letters as PDF.

### 4.4 Before saving or finalising a generated document

Always ask whether he wants the metadata cleaned out: Office document properties, PDF
Info and XMP.

### 4.5 File naming and filing

- The filing drop folder is
  `C:\Users\benja\OneDrive - Rooney Law\Rooney Law\Filing Folder`. Files land there, get
  renamed to the convention, then move into the right Client Files folder.
- When a document goes out with enclosures or attachments, the file name says so:
  `[date] - Letter to [recipient] re [subject] (with Enclosures).pdf`, and a pleading
  filed with exhibits is `[document name] (with Exhibits)`. Same slot as the (FS) and
  (S) tags.

---

## 5. Names, titles and contact details

| | |
|---|---|
| Firm name, public facing | **Rooney Law, P.C.** Always the comma and both periods |
| Tagline | Practical Counsel. Exceptional Results. |
| Benjamin J. Rooney | **Shareholder** or **Attorney at Law**. Never founder, owner, or principal |
| Whitney Bickel | **Legal Assistant** |
| Firm main line | 331.265.7765 |
| Ben direct | 331.265.7775 |
| Firm address for stationery | admin@rooneylawpc.com |
| Ben, personal correspondence | brooney@rooneylawpc.com |
| Office | 217 South Third Street, Geneva, Illinois 60134 |
| Web | rooneylawpc.com |

States are written out. Illinois, never IL, in anything a person reads.

### Retired values. These are wrong wherever they appear.

| Value | What it was |
|---|---|
| `331.265.1111` | A placeholder that reaches nothing. Got into the letterhead, the email signature and the business card |
| `331.265.7776` | Never a firm number. Misread out of the old Word letterhead on 2026-08-28 and propagated before it was caught |
| `+13312651111` | The same placeholder, surviving inside a `tel:` link after the visible number was corrected |
| `info@rooneylawpc.com` | Does not exist |
| `rooneylaw.law` | Never a firm domain, despite being printed on the business card |
| `Rooney Law. P.C.` | Period instead of comma, from the wordmark in the old Word letterhead |

Both numbers are retired in every spelling. The `tel:` link form is listed separately
because it survived one correction when only the visible number was changed.

---

## 6. Standing questions to ask

- Whenever the `email-voice` skill is updated, ask whether the updated markdown should
  also be transferred to his Copilot instructions profile.
