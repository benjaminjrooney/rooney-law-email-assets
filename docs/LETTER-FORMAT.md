# Letter format the add-in reads

Auto-extraction is a convenience, not a gate: everything it finds appears in the
task pane as an editable suggestion, and when it finds nothing it falls back to
regular mail and empty fields. Letters that follow the firm's usual shape get
filled in completely.

## The shape it expects

```
August 25, 2026                                ← date (ignored)
VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED   ← delivery method, near the top
Dana Whitfield                                 ← recipient, right below it
Whitfield Law Group, LLC
900 N. Michigan Avenue, Suite 1400
Chicago, Illinois 60611
dana@whitfieldlaw.example                      ← email/phone lines are skipped
Re:  4120 Sheridan Road                        ← becomes the Lob reference
Dear Ms. Whitfield:                            ← everything below is body text
...
Sincerely,
Benjamin J. Rooney
Attorney, Rooney Law, P.C.                     ← signature block, never the
100 Example Street                               recipient
Geneva, Illinois 60134
Direct: 331.555.0100
cc: Robert Roe (via regular mail)              ← CC block, near the bottom
    Roe Law Group
    1 North Wacker Drive
    Chicago, IL 60606
```

**Blank lines are not required.** The firm's letters space their paragraphs
with paragraph styling rather than empty paragraphs, so the parser never relies
on a blank line to tell where a block starts or ends. The recipient block is
found by anchoring on the salutation: the address above `Dear …` is the
addressee, and anything below it — including the signature block, which carries
the firm's own address — is out of range.

The letterhead is typically in the Word header rather than the body, so it
never reaches the parser at all. When a letter does carry it in the body, it is
skipped by matching against the return address configured on the server.

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
- An email address or a phone line (`dana@…`, `Direct: 331.555.0100`) inside
  the block is skipped rather than treated as part of the address.
- Lines above the street are the name and the company. A line that reads like an
  organization (`LLC`, `Inc.`, `Law Offices`, `Insurance Company`, …) is treated
  as the company, and a personal name — including one with `Esq.`, `Jr.` — as the
  name.
- `Attn:` or `c/o` marks the addressee line, whatever else is in the block.

If the letter has no delivery method line, the search simply starts at the top
of the document and still stops at the salutation.

When no address can be found above the salutation, the pane reports that and
leaves the fields empty. It will not fall back to the signature block — mailing
a letter to the firm's own office is worse than asking for the address.

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
