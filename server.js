// ============================================================
// THE VANCE INQUIRY — session server
// Holds ONE Anthropic API key. Serves the student app AND the
// teacher console AND runs live multiplayer sessions, all from
// one Render service. No student account needed.
//
// Teacher creates a session (difficulty baked in) -> gets a code
// + QR. Students join by name via the QR link, do the inquiry,
// lock ONE final verdict. Teacher screen shows a live scoreboard
// (verdict correctness + intel out of 16). Teacher can launch a
// new round (fresh code + QR) and everyone goes again.
//
// Sessions live in memory. A restart clears them — fine for a
// classroom; nothing to persist.
// ============================================================

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { WITNESSES, DIFFICULTY } = require("./witnesses");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-20250514";
const PORT = process.env.PORT || 8787;
const KILLER_ID = "reeve";
const TOTAL_INTEL = WITNESSES.reduce((s, w) => s + w.intel.length, 0);
const LOCK_MIN_INTEL = 12;            // must uncover at least this many of 16
const LOCK_REQUIRE_ALL_WITNESSES = true; // must have interviewed all four

if (!API_KEY) {
  console.error("FATAL: set ANTHROPIC_API_KEY in the environment before starting.");
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// SESSIONS
// ============================================================
const sessions = {}; // code -> session
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let c;
  do { c = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(""); }
  while (sessions[c]);
  return c;
}

// drop sessions older than 6 hours so memory doesn't creep
function sweep() {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  for (const k of Object.keys(sessions)) if (sessions[k].createdAt < cutoff) delete sessions[k];
}
setInterval(sweep, 30 * 60 * 1000);

function publicScoreboard(sess) {
  return Object.values(sess.players)
    .map((p) => ({
      name: p.name, intel: p.intelCount, locked: p.locked,
      verdict: p.locked ? p.verdict : null,
      correct: p.locked ? p.verdict === KILLER_ID : null,
      lockedAt: p.lockedAt || null,
    }))
    .sort((a, b) => {
      const ac = a.correct ? 1 : 0, bc = b.correct ? 1 : 0;
      if (bc !== ac) return bc - ac;          // correct accusations first
      if (b.intel !== a.intel) return b.intel - a.intel; // then most intel
      return (a.lockedAt || 9e15) - (b.lockedAt || 9e15); // then earliest lock
    });
}

app.post("/api/session/create", (req, res) => {
  const { difficulty = "intermediate" } = req.body || {};
  const diff = DIFFICULTY[difficulty] ? difficulty : "intermediate";
  const code = makeCode();
  sessions[code] = { code, difficulty: diff, createdAt: Date.now(), open: true, players: {} };
  res.json({ code, difficulty: diff });
});

app.post("/api/session/close", (req, res) => {
  const s = sessions[req.body?.code];
  if (!s) return res.status(404).json({ error: "no session" });
  s.open = false;
  res.json({ ok: true, scoreboard: publicScoreboard(s), killer: KILLER_ID, killerName: WITNESSES.find((w) => w.id === KILLER_ID).name });
});

app.get("/api/session/:code/scoreboard", (req, res) => {
  const s = sessions[req.params.code];
  if (!s) return res.status(404).json({ error: "no session" });
  res.json({
    code: s.code, difficulty: s.difficulty, open: s.open,
    players: publicScoreboard(s),
    joined: Object.keys(s.players).length,
    lockedCount: Object.values(s.players).filter((p) => p.locked).length,
    totalIntel: TOTAL_INTEL,
  });
});

app.post("/api/session/join", (req, res) => {
  const s = sessions[req.body?.code];
  if (!s) return res.status(404).json({ error: "That session code wasn't found. Check it or scan the QR again." });
  if (!s.open) return res.status(403).json({ error: "This round has already closed." });
  const name = String(req.body?.name || "").trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: "Enter your name to join." });
  const token = crypto.randomBytes(8).toString("hex");
  s.players[token] = { name, intelCount: 0, locked: false, verdict: null, lockedAt: null };
  res.json({ token, difficulty: s.difficulty, name });
});

app.post("/api/session/progress", (req, res) => {
  const s = sessions[req.body?.code]; if (!s) return res.status(404).json({ error: "no session" });
  const p = s.players[req.body?.token]; if (!p) return res.status(404).json({ error: "no player" });
  if (typeof req.body.intelCount === "number") p.intelCount = Math.max(0, Math.min(TOTAL_INTEL, req.body.intelCount | 0));
  res.json({ ok: true });
});

app.post("/api/session/lock", (req, res) => {
  const s = sessions[req.body?.code]; if (!s) return res.status(404).json({ error: "no session" });
  const p = s.players[req.body?.token]; if (!p) return res.status(404).json({ error: "no player" });
  if (!s.open) return res.status(403).json({ error: "This round has closed." });
  if (p.locked) return res.status(409).json({ error: "already_locked", verdict: p.verdict });
  const verdict = String(req.body?.verdict || "");
  if (!WITNESSES.some((w) => w.id === verdict)) return res.status(400).json({ error: "pick a suspect" });

  // --- lock gate: enough intel AND all witnesses interviewed ---
  const intelCount = Math.max(0, Math.min(TOTAL_INTEL, (req.body?.intelCount | 0)));
  const interviewed = Array.isArray(req.body?.interviewed) ? req.body.interviewed.filter((id) => WITNESSES.some((w) => w.id === id)) : [];
  if (intelCount < LOCK_MIN_INTEL) {
    return res.status(403).json({ error: "gate_intel", message: `You need at least ${LOCK_MIN_INTEL} of ${TOTAL_INTEL} clues before you can accuse. You have ${intelCount}.`, need: LOCK_MIN_INTEL, have: intelCount });
  }
  if (LOCK_REQUIRE_ALL_WITNESSES && interviewed.length < WITNESSES.length) {
    const missing = WITNESSES.filter((w) => !interviewed.includes(w.id)).map((w) => w.name);
    return res.status(403).json({ error: "gate_witnesses", message: `You must interview all four witnesses first. Still to interview: ${missing.join(", ")}.`, missing });
  }

  p.locked = true; p.verdict = verdict; p.lockedAt = Date.now();
  p.intelCount = intelCount;
  res.json({ ok: true, locked: true });
});

// ============================================================
// INTERVIEW ENGINE
// ============================================================
function findWitness(id) { return WITNESSES.find((w) => w.id === id); }

async function callAnthropic(system, messages, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error("Anthropic " + res.status + ": " + t.slice(0, 300)); }
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}
function safeJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean);
}

app.get("/api/witnesses", (req, res) => {
  res.json({
    witnesses: WITNESSES.map((w) => ({
      id: w.id, name: w.name, role: w.role, avatar: w.avatar, accent: w.accent,
      blurb: w.blurb, opening: w.opening, isSuspect: !!w.isSuspect, startTrust: w.startTrust,
      intel: w.intel.map((i) => ({ id: i.id, label: null })),
    })),
    difficulties: Object.fromEntries(Object.entries(DIFFICULTY).map(([k, v]) => [k, { label: v.label, blurb: v.blurb }])),
    totalIntel: TOTAL_INTEL,
    lockMinIntel: LOCK_MIN_INTEL,
    lockRequireAllWitnesses: LOCK_REQUIRE_ALL_WITNESSES,
  });
});

app.post("/api/interview", async (req, res) => {
  try {
    const { witnessId, history = [], trust = 30, unlockedIds = [], difficulty = "intermediate" } = req.body || {};
    const w = findWitness(witnessId);
    if (!w) return res.status(400).json({ error: "unknown witness" });
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
    const remaining = w.intel.filter((i) => !unlockedIds.includes(i.id));
    const unlockedLabels = w.intel.filter((i) => unlockedIds.includes(i.id)).map((i) => i.id).join(", ") || "none yet";

    const system = `${w.bible}

=== DIFFICULTY: ${diff.label.toUpperCase()} ===
${diff.register}
${diff.bar}

=== CURRENT INTERVIEW STATE ===
- Trust level (0 cold/hostile, 100 fully open): ${trust}
- Intel the investigator has ALREADY unlocked from you: ${unlockedLabels}
- Intel still hidden: ${remaining.map((i) => `${i.id} = "${i.label}"`).join("; ") || "none, you've told them everything"}

=== HOW TO RESPOND TO THE INVESTIGATOR'S LATEST MESSAGE ===
1. Stay fully in character per your bible. Reply in 1-4 sentences of natural spoken dialogue at the difficulty's language level. Never narrate mechanics or mention trust/intel/difficulty.
2. Judge their approach: GOOD interviewing (specific, a sharp follow-up seizing on what you just said, rapport, well-judged pressure, knowing when to back off) vs WEAK (vague, leading, cold accusation, fishing, ignoring what you said, repeating themselves). Apply YOUR character's particular preferences.
3. Adjust trust by the difficulty's bar. Range -20 to +20.
4. Unlock a hidden intel item ONLY if genuinely earned this turn per the bar AND trust is high enough for that secret. Deeper secrets need higher trust. Usually unlock 0 per turn; occasionally 1; rarely 2 only if excellent. Never unlock for merely naming a topic.
5. If you've revealed everything, stay in character and converse; don't invent new secrets.

Return ONLY valid JSON, no markdown:
{"reply":"<in-character spoken response>","trustDelta":<int -20..20>,"unlocked":["<intel ids unlocked THIS turn, usually empty>"],"questionQuality":"good"|"weak"|"neutral","coachNote":"<one short private note, max 15 words>"}`;

    const messages = history.map((m) => ({ role: m.role === "you" ? "user" : "assistant", content: m.text }));
    const text = await callAnthropic(system, messages.length ? messages : [{ role: "user", content: "(The investigator sits down.)" }], 500);
    const out = safeJson(text);
    const valid = (out.unlocked || []).filter((id) => w.intel.some((i) => i.id === id) && !unlockedIds.includes(id));
    const unlockedDetail = valid.map((id) => { const it = w.intel.find((i) => i.id === id); return { id, label: it.label }; });
    res.json({
      reply: out.reply || "...",
      trustDelta: Math.max(-20, Math.min(20, out.trustDelta || 0)),
      unlocked: valid, unlockedDetail,
      questionQuality: out.questionQuality || "neutral",
      coachNote: out.coachNote || "",
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "interview_failed" }); }
});

app.post("/api/debrief", async (req, res) => {
  try {
    const { witnessId, history = [], unlockedIds = [], difficulty = "intermediate" } = req.body || {};
    const w = findWitness(witnessId);
    if (!w) return res.status(400).json({ error: "unknown witness" });
    const diff = DIFFICULTY[difficulty] || DIFFICULTY.intermediate;
    const got = w.intel.filter((i) => unlockedIds.includes(i.id)).map((i) => i.label);
    const missed = w.intel.filter((i) => !unlockedIds.includes(i.id)).map((i) => i.label);
    const transcript = history.map((m) => `${m.role === "you" ? "INVESTIGATOR" : w.name.toUpperCase()}: ${m.text}`).join("\n");
    const system = `You are an expert interview coach reviewing a student's investigative interview with ${w.name} (${w.role}) about a suspicious death on a Mars base. The student is an international teenager whose CEFR English level for this session is ${diff.label}.
They unlocked: ${got.length ? got.join("; ") : "NONE"}.
They still missed: ${missed.length ? missed.join("; ") : "nothing, they got everything"}.

TRANSCRIPT:
${transcript}

Write a short, sharp coaching debrief about their INTERVIEW TECHNIQUE (their questioning, follow-ups, rapport, judgement of when to press or ease off). Match your OWN language level to ${diff.label} so a ${diff.label} student understands you. Be specific to what they actually said.
FAIRNESS RULE: This is an investigation skills exercise, NOT an English test. Never criticise their grammar, spelling or vocabulary. Coach only the detective work. A good question asked in imperfect English is a good question.
Return JSON only, no markdown:
{"score":<0-100 — score INTERVIEW TECHNIQUE only, never English accuracy>,"verdict":"<one punchy sentence>","didWell":["<2-3 specific strengths tied to their real questions>"],"improve":["<2-3 actionable tips tied to what they missed and the TECHNIQUE to unlock it, WITHOUT revealing the hidden fact>"]}
Reward good follow-ups, rapport, judging when to press vs ease off, precise questions. Flag leading questions, fishing, cold accusations. For missed intel, hint at the technique never the answer.`;
    const text = await callAnthropic(system, [{ role: "user", content: "Write the debrief." }], 700);
    res.json(safeJson(text));
  } catch (e) { console.error(e); res.status(500).json({ error: "debrief_failed" }); }
});

app.get("/health", (req, res) => res.json({ ok: true, sessions: Object.keys(sessions).length }));
app.get("/teacher", (req, res) => res.sendFile(path.join(__dirname, "public", "teacher.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Vance Inquiry server on :${PORT} (model ${MODEL})`));
