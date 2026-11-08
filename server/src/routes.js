const crypto = require("crypto");
const express = require("express");
const mongoose = require("mongoose");
const { User, Post, Reply, ChatRequest, Message } = require("./models");

const router = express.Router();

// ---------- random handles ----------

const ADJECTIVES = [
  "Quiet", "Brave", "Sleepy", "Curious", "Gentle", "Wild", "Calm", "Honest",
  "Soft", "Restless", "Dreamy", "Patient", "Midnight", "Golden", "Silent",
];
const ANIMALS = [
  "Panda", "Fox", "Owl", "Tiger", "Koala", "Wolf", "Bear", "Deer", "Otter",
  "Falcon", "Rabbit", "Heron", "Badger", "Lynx",
];
const COLORS = [
  "#ff5a1f", "#1db954", "#7c5cff", "#ff4d7e", "#0ea5e9", "#f59e0b",
  "#10b981", "#ef4444", "#8b5cf6", "#ec4899",
];

function randomHandle() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const n = 10 + Math.floor(Math.random() * 90);
  return `${a}${b}${n}`;
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// ---------- tiny safety net ----------
// Anonymous boards live or die on this. Short list on purpose: it stops
// the worst drive-by abuse without playing censor. Anything reported by
// three different readers hides itself until a human looks.
const BLOCKED_WORDS = ["kys", "kill yourself", "rape", "molest"];
const HIDE_AFTER_REPORTS = 3;

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function hasBlockedWord(text) {
  const low = text.toLowerCase();
  return BLOCKED_WORDS.some((w) => low.includes(w));
}

// ---------- auth: the device token is the whole login ----------

async function auth(req, res, next) {
  const token = req.get("x-token");
  if (!token) return res.status(401).json({ error: "no identity yet" });
  const user = await User.findOne({ token });
  if (!user) return res.status(401).json({ error: "unknown identity" });
  req.user = user;
  next();
}

function threadKey(a, b) {
  return [String(a), String(b)].sort().join(":");
}

function publicUser(u) {
  return { id: u._id, handle: u.handle, color: u.color };
}

// ---------- identity ----------

// ~160 everyday words; five of them in a row is a phrase nobody can
// guess (and the recover endpoint rate-limits anyone who tries).
const PHRASE_WORDS = (
  "apple river tiger cloud mango stone paper bridge garden window market " +
  "coffee silver golden happy quiet brave lemon pepper rocket forest " +
  "ocean desert island valley meadow harbor lantern velvet copper marble " +
  "sunny rainy windy snowy misty amber coral ivory jade pearl ruby " +
  "panda tiger zebra koala otter heron falcon badger lynx wolf deer " +
  "table chair shelf door lamp clock mirror basket kettle pillow blanket " +
  "guitar violin trumpet drum piano flute song dance story poem novel " +
  "north south east west hill lake pond beach cliff cave dune reef " +
  "morning evening night dawn dusk spring summer autumn winter monsoon " +
  "bread butter honey milk cheese rice wheat corn potato tomato onion " +
  "shirt pocket button collar sleeve cotton denim leather canvas wool " +
  "king queen knight castle village town city street road path trail " +
  "star moon comet comet orbit planet galaxy comet meteor comet"
).split(/\s+/).filter((w, i, a) => a.indexOf(w) === i);

function randomPhrase() {
  const words = [];
  while (words.length < 5) {
    const w = PHRASE_WORDS[Math.floor(Math.random() * PHRASE_WORDS.length)];
    if (!words.includes(w)) words.push(w);
  }
  return words.join(" ");
}

function phraseHash(phrase) {
  const normalized = String(phrase || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

router.post("/me", async (req, res) => {
  const given = clean(req.body && req.body.token);
  if (given) {
    const existing = await User.findOne({ token: given });
    if (existing) {
      // accounts born before login phrases existed get theirs now, once
      if (!existing.recoveryHash) {
        const phrase = randomPhrase();
        existing.recoveryHash = phraseHash(phrase);
        await existing.save();
        return res.json({ user: publicUser(existing), token: existing.token, phrase });
      }
      return res.json({ user: publicUser(existing), token: existing.token });
    }
  }
  const phrase = randomPhrase();
  const handle = randomHandle();
  const user = await User.create({
    token: crypto.randomBytes(24).toString("hex"),
    handle,
    handleNorm: handle.toLowerCase(),
    color: randomColor(),
    recoveryHash: phraseHash(phrase),
  });
  // the phrase is returned exactly once — at account creation
  res.json({ user: publicUser(user), token: user.token, phrase });
});

// Recover an account on a new device with its login phrase.
// Attempts are counted per IP; ten misses and you wait ten minutes.
const recoverAttempts = new Map(); // ip -> { count, firstAt }

router.post("/me/recover", async (req, res) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const entry = recoverAttempts.get(ip) || { count: 0, firstAt: now };
  if (now - entry.firstAt > 10 * 60 * 1000) { entry.count = 0; entry.firstAt = now; }
  if (entry.count >= 10) {
    return res.status(429).json({ error: "too many tries — wait ten minutes" });
  }
  entry.count += 1;
  recoverAttempts.set(ip, entry);

  const phrase = clean(req.body && req.body.phrase);
  if (!phrase) return res.status(400).json({ error: "type your login phrase" });
  const user = await User.findOne({ recoveryHash: phraseHash(phrase) });
  if (!user) return res.status(404).json({ error: "that phrase doesn't match any name here — check the words and try again" });
  recoverAttempts.delete(ip);
  res.json({ user: publicUser(user), token: user.token });
});

router.post("/me/reroll", auth, async (req, res) => {
  req.user.handle = randomHandle();
  req.user.handleNorm = req.user.handle.toLowerCase();
  req.user.color = randomColor();
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

// ---------- pick your own name ----------

// Names nobody may claim: the house accounts and anything official-ish.
const RESERVED_NAMES = [
  "teamspill", "spill", "spillteam", "admin", "administrator", "mod",
  "moderator", "official", "support", "system", "anonymous", "owner",
];

function nameProblem(name) {
  if (name.length < 2) return "too short — at least 2 characters";
  if (name.length > 20) return "too long — 20 characters max";
  if (!/^[A-Za-z0-9_ ]+$/.test(name)) return "letters, numbers, spaces and _ only";
  if (!/[A-Za-z]/.test(name)) return "give it at least one letter";
  const squashed = name.toLowerCase().replace(/[\s_]+/g, "");
  if (RESERVED_NAMES.includes(squashed)) return "that name is reserved";
  if (hasBlockedWord(name)) return "that name can't be used here";
  return null;
}

async function nameTaken(name, exceptUserId) {
  const norm = name.toLowerCase();
  const clash = await User.findOne({
    _id: { $ne: exceptUserId },
    $or: [
      { handleNorm: norm },
      // accounts created before handleNorm existed
      { handle: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    ],
  });
  return Boolean(clash);
}

router.post("/me/name", auth, async (req, res) => {
  const name = clean(req.body && req.body.name);
  const problem = nameProblem(name);
  if (problem) return res.status(400).json({ error: problem });
  if (name.toLowerCase() === req.user.handle.toLowerCase()) {
    return res.json({ user: publicUser(req.user) });
  }
  if (await nameTaken(name, req.user._id)) {
    return res.status(409).json({ error: `"${name}" is already taken — try another` });
  }
  req.user.handle = name;
  req.user.handleNorm = name.toLowerCase();
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

// availability check while typing, so the answer comes before the save
router.get("/me/name-available", auth, async (req, res) => {
  const name = clean(req.query.name);
  const problem = nameProblem(name);
  if (problem) return res.json({ available: false, reason: problem });
  if (name.toLowerCase() === req.user.handle.toLowerCase()) {
    return res.json({ available: true });
  }
  const taken = await nameTaken(name, req.user._id);
  res.json(taken ? { available: false, reason: `"${name}" is already taken` } : { available: true });
});

// ---------- confessions ----------

const REACTION_FIELDS = { heart: "hearts", fire: "fires", cry: "crys", skull: "skulls" };

function reactionSummary(p, viewerId) {
  const counts = {};
  const mine = {};
  for (const [kind, field] of Object.entries(REACTION_FIELDS)) {
    const list = p[field] || [];
    counts[kind] = list.length;
    mine[kind] = viewerId ? list.some((u) => String(u) === String(viewerId)) : false;
  }
  return { counts, mine };
}

function postJson(p, viewerId) {
  return {
    id: p._id, authorId: p.author, handle: p.handle, color: p.color,
    text: p.text, replyCount: p.replyCount, createdAt: p.createdAt,
    reactions: reactionSummary(p, viewerId),
  };
}

// feed reads fine logged-out too; a token just adds "you reacted" flags
async function softUser(req) {
  const token = req.get("x-token");
  if (!token) return null;
  return User.findOne({ token }).lean().catch(() => null);
}

router.get("/feed", async (req, res) => {
  const viewer = await softUser(req);
  const sort = req.query.sort === "top" ? { hearts: -1, createdAt: -1 } : { createdAt: -1 };
  const posts = await Post.find({ hidden: false }).sort(sort).limit(60).lean();
  res.json({ posts: posts.map((p) => postJson(p, viewer && viewer._id)) });
});

router.post("/posts", auth, async (req, res) => {
  const text = clean(req.body && req.body.text);
  if (text.length < 3) return res.status(400).json({ error: "write a little more than that" });
  if (text.length > 600) return res.status(400).json({ error: "600 characters max" });
  if (hasBlockedWord(text)) return res.status(400).json({ error: "that one can't be posted — keep it kind" });
  const post = await Post.create({
    author: req.user._id, handle: req.user.handle, color: req.user.color, text,
  });
  res.json({ id: post._id });
});

router.get("/posts/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "post not found" });
  const post = await Post.findById(req.params.id).lean();
  if (!post || post.hidden) return res.status(404).json({ error: "post not found" });
  const viewer = await softUser(req);
  const replies = await Reply.find({ post: post._id }).sort({ createdAt: 1 }).lean();
  res.json({
    post: postJson(post, viewer && viewer._id),
    replies: replies.map((r) => ({
      id: r._id, authorId: r.author, handle: r.handle, color: r.color,
      text: r.text, createdAt: r.createdAt,
    })),
  });
});

router.post("/posts/:id/replies", auth, async (req, res) => {
  const text = clean(req.body && req.body.text);
  if (text.length < 1) return res.status(400).json({ error: "empty reply" });
  if (text.length > 400) return res.status(400).json({ error: "400 characters max" });
  if (hasBlockedWord(text)) return res.status(400).json({ error: "that one can't be posted — keep it kind" });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "post not found" });
  const post = await Post.findById(req.params.id);
  if (!post || post.hidden) return res.status(404).json({ error: "post not found" });
  const reply = await Reply.create({
    post: post._id, author: req.user._id,
    handle: req.user.handle, color: req.user.color, text,
  });
  post.replyCount += 1;
  await post.save();
  res.json({ id: reply._id });
});

router.post("/posts/:id/react", auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "post not found" });
  const kind = clean(req.body && req.body.kind);
  const field = REACTION_FIELDS[kind];
  if (!field) return res.status(400).json({ error: "unknown reaction" });
  const post = await Post.findById(req.params.id);
  if (!post || post.hidden) return res.status(404).json({ error: "post not found" });
  const list = post[field];
  const i = list.findIndex((u) => String(u) === String(req.user._id));
  if (i >= 0) list.splice(i, 1); else list.push(req.user._id);
  await post.save();
  res.json(reactionSummary(post, req.user._id));
});

router.post("/posts/:id/report", auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: "post not found" });
  }
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "post not found" });
  // one report per reader — nobody hides a post single-handedly
  if (post.reportedBy.some((u) => String(u) === String(req.user._id))) {
    return res.json({ ok: true, already: true });
  }
  post.reportedBy.push(req.user._id);
  post.reports += 1;
  if (post.reports >= HIDE_AFTER_REPORTS) post.hidden = true;
  await post.save();
  res.json({ ok: true });
});

// ---------- private talk ----------

router.post("/requests", auth, async (req, res) => {
  const toId = clean(req.body && req.body.toUserId);
  if (!toId || toId === String(req.user._id)) {
    return res.status(400).json({ error: "can't request a chat with yourself" });
  }
  if (!mongoose.isValidObjectId(toId)) return res.status(404).json({ error: "person not found" });
  const target = await User.findById(toId);
  if (!target) return res.status(404).json({ error: "person not found" });
  const existing = await ChatRequest.findOne({
    $or: [
      { from: req.user._id, to: target._id },
      { from: target._id, to: req.user._id },
    ],
    status: { $in: ["pending", "accepted"] },
  });
  if (existing) {
    return res.json({ status: existing.status, already: true });
  }
  const request = await ChatRequest.create({
    from: req.user._id, to: target._id,
    post: req.body.postId || undefined,
  });
  req.app.get("notify")(target._id, "request:new", { requestId: request._id });
  res.json({ status: "pending", requestId: request._id });
});

router.get("/requests", auth, async (req, res) => {
  const incoming = await ChatRequest.find({ to: req.user._id, status: "pending" })
    .sort({ createdAt: -1 }).lean();
  const fromUsers = await User.find({ _id: { $in: incoming.map((r) => r.from) } }).lean();
  const byId = new Map(fromUsers.map((u) => [String(u._id), u]));
  res.json({
    incoming: incoming.map((r) => ({
      id: r._id, postId: r.post || null,
      from: publicUser(byId.get(String(r.from)) || { _id: r.from, handle: "Someone", color: "#999" }),
      createdAt: r.createdAt,
    })),
  });
});

router.post("/requests/:id/:action", auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "request not found" });
  const request = await ChatRequest.findById(req.params.id);
  if (!request || String(request.to) !== String(req.user._id) || request.status !== "pending") {
    return res.status(404).json({ error: "request not found" });
  }
  if (req.params.action === "accept") request.status = "accepted";
  else if (req.params.action === "decline") request.status = "declined";
  else return res.status(400).json({ error: "unknown action" });
  await request.save();
  if (request.status === "accepted") {
    req.app.get("notify")(request.from, "request:accepted", { requestId: request._id });
  }
  res.json({ status: request.status });
});

async function acceptedBetween(a, b) {
  return ChatRequest.findOne({
    $or: [
      { from: a, to: b },
      { from: b, to: a },
    ],
    status: "accepted",
  });
}

router.get("/threads", auth, async (req, res) => {
  const accepted = await ChatRequest.find({
    $or: [{ from: req.user._id }, { to: req.user._id }],
    status: "accepted",
  }).lean();
  const otherIds = accepted.map((r) => (String(r.from) === String(req.user._id) ? r.to : r.from));
  const users = await User.find({ _id: { $in: otherIds } }).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const threads = [];
  for (const otherId of otherIds) {
    const last = await Message.findOne({ thread: threadKey(req.user._id, otherId) })
      .sort({ createdAt: -1 }).lean();
    const other = byId.get(String(otherId));
    if (other) threads.push({ with: publicUser(other), last: last ? { text: last.text, at: last.createdAt } : null });
  }
  threads.sort((a, b) => new Date((b.last && b.last.at) || 0) - new Date((a.last && a.last.at) || 0));
  res.json({ threads });
});

router.get("/threads/:userId/messages", auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) return res.status(404).json({ error: "person not found" });
  const other = await User.findById(req.params.userId);
  if (!other) return res.status(404).json({ error: "person not found" });
  if (!(await acceptedBetween(req.user._id, other._id))) {
    return res.status(403).json({ error: "you can only talk once both sides say yes" });
  }
  const messages = await Message.find({ thread: threadKey(req.user._id, other._id) })
    .sort({ createdAt: 1 }).limit(200).lean();
  res.json({
    with: publicUser(other),
    messages: messages.map((m) => ({
      id: m._id, mine: String(m.from) === String(req.user._id),
      text: m.text, createdAt: m.createdAt,
    })),
  });
});

module.exports = { router, threadKey, acceptedBetween, clean, hasBlockedWord };
