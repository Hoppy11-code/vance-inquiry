# The Vance Inquiry — live classroom edition

An investigative-interview simulation for Samiad. Students interview four
witnesses on a Mars base to work out who killed Dr Elin Vance. Now runs as a
**live multiplayer session**: the teacher sets the difficulty, puts a QR code
on the board, students join by name on their own devices, lock in one final
verdict, and a live scoreboard updates on the teacher's screen. The teacher
can then launch a fresh round with a new QR code.

**No student needs a Claude account or any login.** Everything runs from one
small server that holds a single API key.

## What's in the box

- `server.js` — the one server. Holds your API key, runs the AI interview
  engine, hosts the sessions/scoreboard, AND serves both web pages.
- `public/index.html` — the student app (join, investigate, lock in).
- `public/teacher.html` — the teacher console (difficulty, QR, live scoreboard).
- `witnesses.js` — the four character bibles, secrets, difficulty profiles.
  Lives only on the server, so answers never reach the browser.
- `package.json` — dependencies (express, cors).

## How a lesson runs

1. Teacher opens `/teacher`, picks Beginner / Intermediate / Advanced, clicks
   **Create session**. A 4-letter code and a big QR code appear.
2. Teacher puts that on the board. Students scan the QR (or type the code at
   the site), enter their name, and start investigating on their own devices.
3. As students uncover intel, the teacher's scoreboard fills in live: who's
   joined, how much intel each has (out of 16), and who's locked in.
4. Each student interviews the four witnesses, then **locks in one final
   verdict** naming the killer. One lock, no changes.
5. Teacher clicks **Close round & reveal** — the board shows the real killer
   and ranks students by correct verdict first, then by intel uncovered.
6. Teacher clicks **New round** for a fresh code/QR and the class goes again.

The students never see the solution in their app; only the teacher reveals it
on the board, so the case isn't spoiled for the next round.

## Deploy on Render (one service, cheapest + easiest)

Everything lives in one service, so there's one deploy and one place billing
happens.

1. Get an Anthropic API key at console.anthropic.com (a billing-enabled
   account). This is the only account involved — yours.
2. Push these files to a GitHub repo (keep the `public/` folder structure).
3. On Render: **New > Web Service**, point at the repo.
   - Build command: `npm install`
   - Start command: `node server.js`
   - Add environment variable `ANTHROPIC_API_KEY` = your key.
4. Deploy. You'll get a URL like `https://vance-xxxx.onrender.com`.

That's it. The teacher console is at `https://vance-xxxx.onrender.com/teacher`
and the student app is at the root. The QR code is generated automatically and
already points students to the right place with the session code embedded.

### Why not Netlify?
Netlify is great for static files but can't run a persistent server, and the
live scoreboard needs one (it holds the session state and pushes updates).
Render runs that server happily and serves the pages too, so one Render service
is simpler and cheaper than splitting across two hosts.

## The difficulty levels = the student's CEFR English level

Difficulty is the student's English level as a foreign-language speaker, NOT how
hard the case is. The mystery is exactly as hard to solve at every level. What
changes is how the witnesses speak, and how forgiving they are of the student's
own English. A clue is unlocked on the quality of the *investigative question*,
never on grammar or vocabulary — a sharp question in broken English still earns
the clue.

| Level | How the witness speaks | How they treat the student's English |
|---|---|---|
| Beginner (A2–B1) | Simple, short, clear sentences; no idioms | Fully patient with mistakes; understands broken English |
| Intermediate (B1–B2) | Natural, fluent conversational English | Expects functional English; doesn't penalise errors |
| Advanced (C1–C2) | Rich, idiomatic; implies rather than states | Engages as a fluent speaker |

## Locking in a verdict

A student can only accuse once they have uncovered at least **12 of 16 clues**
**and interviewed all four witnesses**. This guarantees they work the full case
rather than guessing early, which is what fills a 40–45 minute lesson. Both
thresholds are enforced on the server and adjustable at the top of `server.js`
(`LOCK_MIN_INTEL`, `LOCK_REQUIRE_ALL_WITNESSES`).

## Rough cost

Each interview turn and each debrief is one short model call (Sonnet, a few
hundred tokens). A class of 30 doing several interviews each is a small number
of pounds per session, billed to you per use, not per student. Sessions live in
memory and clear on restart; nothing to host a database for.

## Tuning after watching a class

Everything tunable is in `witnesses.js`: each witness's `startTrust`, or the
`bar` wording in the `DIFFICULTY` block. Redeploy and every student gets the
change. The pages don't need touching.

## Local testing

```
ANTHROPIC_API_KEY=sk-ant-... node server.js
```
Then open http://localhost:8787/teacher in one tab and http://localhost:8787/
in another to play both sides.

## Optional: Zombie skin

The whole case is one file (`witnesses.js`). A Zombie-week version (uncovering
what caused the outbreak) is the same architecture with a different four-witness
case. Say the word and it's a second case file.
