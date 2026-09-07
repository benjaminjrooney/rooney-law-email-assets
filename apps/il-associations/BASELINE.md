# Baseline — Rooney Law founded — first standings

Fixed on 2026-09-07 from import run #1.
Secretary of State files dated 2026-08-24.

**Denominator: 23,015 qualifying associations** —
registered entities, in good standing or not, excluding the dissolved.

Roster: 33,811 across both families
(1,602 LLC, 32,209 corporations), all statuses.

## The market by category

| Category | Agents | Associations | Share |
|---|---:|---:|---:|
| Individual / unknown | 12,250 | 16,859 | 73.25% |
| Law firm | 110 | 3,786 | 16.45% |
| Other organization / review | 203 | 1,188 | 5.16% |
| Management company | 92 | 1,182 | 5.14% |

## Law firms

| Firm | Associations | Share |
|---|---:|---:|
| KSN REGISTERED AGENT, LLC | 2,508 | 10.90% |
| COSTELLO SURY & ROONEY, P.C. | 415 | 1.80% |
| BURKELAW AGENTS, INC. | 301 | 1.31% |
| SHIFRIN LEGAL, INC. | 150 | 0.65% |
| TRESSLER CORPORATE SERVICES, INC. | 145 | 0.63% |
| CERVANTES, CHATT & PRINCE P.C. | 80 | 0.35% |
| FULLETT SWANSON P.C. | 19 | 0.08% |
| THE GIRARD LAW GROUP, P.C. | 15 | 0.07% |
| LAVELLE LAW, LTD. | 11 | 0.05% |
| ZABEL LAW, LLC | 8 | 0.03% |
| CLAVIO, VAN ORDSTRAND & ASSOCIATES, LLP | 6 | 0.03% |
| ERIC FELDMAN & ASSOCIATES, P.C. | 3 | 0.01% |
| BROOKS LAW FIRM,  A PROFESSIONAL CORPORATION | 3 | 0.01% |
| GASPERO & GASPERO, ATTORNEYS AT LAW, P.C. | 3 | 0.01% |
| TRESSLER CORPORATE SERVICES, I | 3 | 0.01% |
| VENDIOLA LAW, LLC | 3 | 0.01% |
| GOULD & RATNER LLP | 3 | 0.01% |
| KOZAR LAW OFFICE, LLC | 3 | 0.01% |
| ZRFM LAW, LLC | 3 | 0.01% |
| O'FLAHERTY LAW, P C | 2 | 0.01% |

These 20 hold 3,684 — 16.01% of the market.

---

## What this file is

The fixed point every later figure is measured against, copied out of the
database and into the repository. The database itself holds it three ways —
`app_settings.baseline`, the standings in `agent_share_history`, and the
weekly decisions backup — and has still been lost twice in a day. A reference
point that exists only inside the thing it describes is not one.

Everything above was emitted by `npm run baseline:report` against production
and pasted verbatim. To regenerate it, run that script again; to move the
baseline itself, `npm run baseline:mark -- --force`, which is deliberately
awkward.

## How to read the numbers

The denominator is the default view of the roster: 23,015 of the 33,811
matched entities. The other ten thousand are dissolved, revoked, merged or
withdrawn — they cannot instruct anybody, and counting them would understate
every firm by a third. "Not in good standing" is kept, because those
associations are still there and still need a lawyer.

A firm's share is its associations in that same view, divided by that
denominator. Both halves come from one filter, so a figure here and the same
figure on the Market share tab agree.

Two caveats to state whenever this is quoted:

- Agents are grouped conservatively — two spellings of one firm stay apart
  until someone merges them. Note "TRESSLER CORPORATE SERVICES, INC." and
  "TRESSLER CORPORATE SERVICES, I", the same firm truncated by the state's
  fixed-width file. Shares are therefore floors, not ceilings.
- 73% of associations name an individual rather than an organisation, usually
  a lawyer or a board member. Some of that is law-firm work under a personal
  name and is not counted here.
