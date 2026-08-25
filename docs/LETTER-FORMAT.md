# Letter format the add-in reads

Auto-extraction is a convenience, not a gate: everything it finds appears in the
task pane as an editable suggestion, and when it finds nothing it falls back to
regular mail and empty fields. Letters that follow the firm's usual shape get
filled in completely.

## The shape it expects

```
ROONEY LAW                                     ← letterhead (ignored)
123 North LaSalle Street, Suite 1200
Chicago, Illinois 60602

August 25, 2026                                ← date (ignored)

VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED   ← delivery method, at the top

Jane Doe, Esq.                                 ← recipient, right below it
Doe & Associates LLC
500 West Madison Street, Suite 1000
Chicago, Illinois 60661

Re: Smith v. Jones, Case No. 2026 L 001234     ← becomes the Lob reference

Dear Ms. Doe:

...

Sincerely,

Benjamin J. Rooney

cc: Robert Roe (via regular mail)              ← CC block, near the bottom
    Roe Law Group
    1 North Wacker Drive
    Chicago, IL 60606
```

## Delivery method line

Recognized on the first line near the top that starts with `VIA`, `BY`, `SENT
VIA`, or is written in all capitals:

| Text in the letter | Mail class chosen |
| --- | --- |
| `CERTIFIED MAIL, RETURN RECEIPT REQUESTED`, `RETURN RECEIPT REQUESTED` | Certified with return receipt |
| `CERTIFIED MAIL` | Certified |
| `REGISTERED MAIL` | Registered |
| `FIRST-CLASS MAIL`, `U.S. MAIL`, `REGULAR MAIL`, `USPS` | Regular |
| anything else, or no line at all | Regular, with a warning in the pane |

A line naming both a physical and an electronic method — `VIA EMAIL AND
CERTIFIED MAIL` — mails the certified copy and notes in the pane that the email
still has to be sent separately. A line naming only email, fax, hand delivery,
overnight courier, or e-filing produces no mailing suggestion: the pane warns and
leaves the class at regular, so nothing goes out by mistake.

Prose in the body that mentions certified mail is not mistaken for the header —
only the top of the letter is scanned, and only header-shaped lines count.

## Recipient block

The block of lines directly under the delivery method, ending in a
`City, State ZIP` line. Both `Chicago, IL 60661` and `Chicago, Illinois
60661-1234` are understood.

Within the block:

- The last line before the city line is the street address; a standalone
  `Suite 1000`, `Floor 4`, or `Unit B` line becomes the second address line.
- `P.O. Box 4820` is recognized as a street line.
- Lines above the street are the name and the company. A line that reads like an
  organization (`LLC`, `Inc.`, `Law Offices`, `Insurance Company`, …) is treated
  as the company, and a personal name — including one with `Esq.`, `Jr.` — as the
  name.
- `Attn:` or `c/o` marks the addressee line, whatever else is in the block.

If the letter has no delivery method line, the recipient is found by looking for
the address block followed by `Re:` or `Dear`. The firm's own letterhead is
scored down using the return address configured on the server, so it is not
picked up as the recipient.

## CC block

Starts at the last line beginning with `cc:`, `c.c.`, `copy to`, or `copies to`,
and runs to the end of the letter or to an `Enclosures` / `Attachments` line.
Blank lines separate multiple CC recipients.

Each CC entry may name its own delivery method, either in parentheses or after a
dash:

```
cc: Jane Doe, Esq. (via certified mail, return receipt requested)
    Doe & Associates LLC
    500 West Madison Street
    Chicago, IL 60661

    Robert Roe - via regular mail
    1 North Wacker Drive
    Chicago, IL 60606
```

A CC without its own method inherits the letter's mail class. A one-line CC
(`cc: Robert Roe, 1 North Wacker Drive, Chicago, IL 60606`) is also parsed.

Every CC found becomes a checkbox in the task pane. **Each checked copy is
mailed as its own physical letter** with the same PDF, at its own mail class, and
is charged separately. A CC named without an address (`cc: Client`) appears
unchecked with a warning rather than being dropped silently.

## When extraction misses

Fix it in the task pane and send — the parse is only a starting point. If a
letter shape misses repeatedly, that is worth encoding: the rules live in
`apps/word-addin/public/js/parse-letter.js` and their tests, with one test per
letter shape, in `apps/word-addin/test/parse-letter.test.js`.
