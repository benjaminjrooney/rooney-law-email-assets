# Record layouts

Fixed-width field positions for the Illinois Secretary of State
[Business Data Transparency Act](https://www.ilsos.gov/data/bus-serv-home.html)
bulk files.

## Why this directory is (almost) empty

**This application ships almost no field positions.** The official ILSOS
record-layout documentation could not be retrieved when the application was
built, and the brief is explicit that field definitions must never be invented —
a guessed column boundary silently corrupts every record it touches, and a
guessed status code silently mislabels an entity's legal standing.

So layouts are *operator-owned data*, not code. Five of the six files have a row
in the `record_layouts` table that starts out `unconfirmed` with an empty field
list, and **the importer refuses to run in write mode against an unconfirmed
layout**.

### The one exception: LLC Name

This build has seen a real September 2026 `llcallnam.txt`, so that layout is
seeded as confirmed:

| Columns | Field | Role |
|---|---|---|
| 1–8 | Illinois file number | `file_number` |
| 9–128 | Legal entity name | `legal_name` |

Records are **variable length**, CRLF-delimited, with **no gutter** between the
two fields, and the file closes with an `END OF FILE RECORD COUNT=` trailer.
Across all 1,494,050 records every one carries eight leading digits, and there
are no repeated file numbers — one record per entity.

Its `provenance` is `operator_confirmed`, not `documented`, and its citation
says so: it was derived from the data, not transcribed from the official record
layout. If you obtain the real documentation and it disagrees, the documentation
wins — re-edit the layout in the wizard.

### What a real header looks like

```
RUN DATE=20260904   FILE:LLC MASTER NAME DATA
```

It names the **dataset**, not the filename: checking for `llcallnam` would
reject every genuine file. The expected text for each slot is recorded when you
confirm that slot's layout, and until then a file is reported to you but never
rejected.

## Filling one in

1. Open **Imports and updates → your bundle → Step 2**.
2. The left column shows what the importer could observe in *your* file: the
   record length, and the column boundaries where every sampled record is blank.
   This is a cross-check, not an answer — two fields that sit flush against each
   other cannot be separated by inspection.
3. The right column is yours. Transcribe the field positions from the official
   ILSOS record-layout documentation into the JSON field list, cite the document
   you used, and press **Save and confirm**.

A layout cannot be confirmed unless it cites a source document and maps every
role the importer needs for that file kind.

## Field shape

```jsonc
{
  "key": "legal_name",          // unique within the layout
  "label": "Legal name",        // shown in the UI
  "start": 10,                  // 1-based inclusive start column
  "length": 60,                 // width in characters
  "role": "legal_name",         // see SEMANTIC_ROLES below
  "provenance": "documented",   // documented | operator_confirmed | unmapped
  "documentedBy": "ILSOS LLC file layout, rev. 2019-05, page 2",
  "notes": "optional"
}
```

`provenance` is the honesty mechanism:

| value | meaning |
|---|---|
| `documented` | transcribed straight from official documentation; a `documentedBy` citation is required |
| `operator_confirmed` | an operator checked this column against the documentation |
| `unmapped` | the column exists but its meaning has not been established |

Any column left `unmapped` is parsed and **retained verbatim** in the record's
`raw_source` JSON, and surfaced in the UI as its raw source code — never as a
guessed meaning. That is why entity status currently displays as
*"Source code not yet mapped."*: no documented code list has been supplied, so
the app shows the raw code and disables the Active-only filter rather than
inventing a mapping.

### Roles the importer understands

Required per file kind:

| File | Required roles |
|---|---|
| Name (`*allnam`) | `file_number`, `legal_name` |
| Agent (`*allagt`) | `file_number`, `agent_name` |
| Master (`*allmst`) | `file_number` |

Optional roles, used when mapped: `name_type_code`, `agent_street`,
`agent_city`, `agent_state`, `agent_zip`, `agent_county`, `agent_change_date`,
`registered_office_street`, `registered_office_city`,
`registered_office_state`, `registered_office_zip`, `entity_type_code`,
`status_code`, `organization_date`, `effective_date`, `extended_date`.

Anything else: `unmapped`.

## Encoding

Records are decoded as **latin1** (one byte, one character) so that a stray
high byte cannot shift every column after it. Do not change this without
checking the source files' actual encoding.

## Once confirmed

Layouts are versioned in the database and every confirmation is audit-logged
with the actor, the timestamp and the cited document. Re-confirming bumps the
version; previous imports keep pointing at the run that produced them.

`TEMPLATE.json` in this directory is a starting point you can paste into the
editor and edit — every field in it is `unmapped`, with no positions asserted.
