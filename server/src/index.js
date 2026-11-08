const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { router, threadKey, acceptedBetween, clean, hasBlockedWord } = require("./routes");
const { makeNotify } = require("./notify");
const { User, Message, Post } = require("./models");

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || "";

const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,https://spill.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // curl, server-to-server
  return allowedOrigins.includes(origin);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: (origin, cb) => cb(null, originAllowed(origin)) }));
app.use(express.json({ limit: "32kb" }));
// a JSON API needs few headers, but it needs these: no sniffing our
// responses into something else, no framing, no referrer leakage
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  next();
});
app.use("/api", router);
app.get("/", (req, res) => res.json({ name: "spill-api", ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
});

// one room per person: user:<id> — that's where requests and DMs land
app.set("notify", (userId, event, payload) => {
  io.to(`user:${userId}`).emit(event, payload);
});

// the full notification path (bell + socket toast + browser push)
app.set("notifyUser", makeNotify(app));

// who's here right now — the little pink-dot number in the hero
const onlineUsers = new Map(); // userId -> socket count

function broadcastPresence() {
  io.emit("presence", { online: onlineUsers.size });
}

io.on("connection", (socket) => {
  let me = null;

  socket.on("identify", async (token) => {
    try {
      if (!token || typeof token !== "string") return;
      const user = await User.findOne({ token }).lean();
      if (!user) return;
      me = user;
      socket.join(`user:${user._id}`);
      const key = String(user._id);
      onlineUsers.set(key, (onlineUsers.get(key) || 0) + 1);
      broadcastPresence();
    } catch (err) {
      // a bad identify just means no live updates for this socket
    }
  });

  socket.on("disconnect", () => {
    if (!me) return;
    const key = String(me._id);
    const left = (onlineUsers.get(key) || 1) - 1;
    if (left <= 0) onlineUsers.delete(key); else onlineUsers.set(key, left);
    broadcastPresence();
  });

  socket.on("dm:send", async ({ toUserId, text }) => {
    try {
      if (!me) return;
      const body = clean(text);
      if (!body || body.length > 1000 || hasBlockedWord(body)) return;
      const other = await User.findById(toUserId);
      if (!other) return;
      if (!(await acceptedBetween(me._id, other._id))) return;
      const message = await Message.create({
        thread: threadKey(me._id, other._id), from: me._id, text: body,
      });
      const payload = {
        id: message._id, fromId: me._id, text: message.text,
        createdAt: message.createdAt,
      };
      io.to(`user:${other._id}`).emit("dm:new", payload);
      socket.emit("dm:new", payload); // echo so the sender sees it land
      app.get("notifyUser")(other._id, {
        type: "message", actorId: me._id,
        actorHandle: me.handle, actorColor: me.color,
        withUser: me._id,
        text: body.length > 120 ? body.slice(0, 117) + "…" : body,
      }).catch(() => {});
    } catch (err) {
      // dropped quietly — the sender can retry; nothing half-saved
    }
  });
});

async function seed() {
  // the team account itself is ensured on every boot, not just the
  // first: its colour is brand, and brand changes should reach it
  let team = await User.findOne({ handle: "TeamSpill" });
  if (!team) {
    team = await User.create({
      token: "spill-team", handle: "TeamSpill", color: "#ffb6c1",
    });
  } else if (team.color !== "#ffb6c1") {
    team.color = "#ffb6c1"; // brand moved to baby pink
    await team.save();
  }
  // posts carry a snapshot of the author's colour from when they were
  // written, so the team's old posts need the new colour painted on too
  await Post.updateMany({ author: team._id }, { color: "#ffb6c1" });

  const count = await Post.countDocuments();
  if (count > 0) return;
  await Post.create([
    {
      author: team._id, handle: team.handle, color: team.color,
      text: "Welcome to Spill. This is the campus wall where everything unsaid gets said — crushes, rants, hostel stories, exam fears. No real names, no judgement. Your random name is yours alone; tap it up top to re-roll it.",
    },
    {
      author: team._id, handle: team.handle, color: team.color,
      text: "How private talk works: if someone's confession hits home, tap “Talk privately” on their post. They choose whether to accept. Nothing reaches anyone without a yes — that's the rule that keeps this place safe.",
    },
  ]);
}

async function start() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set — the API has nowhere to store anything.");
    process.exit(1);
  }
  await mongoose.connect(MONGODB_URI, { dbName: process.env.DB_NAME || "spill" });
  await seed();
  server.listen(PORT, () => console.log(`spill-api listening on ${PORT}`));
}

start();

// a stray async failure somewhere should log, not kill the process —
// one bad request is not worth taking the whole wall down
process.on("unhandledRejection", (err) => {
  console.error("unhandled rejection:", err && err.message ? err.message : err);
});

// last-resort error handler: a bad request should get a JSON answer,
// never a crashed process
app.use((err, req, res, next) => {
  console.error(err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status((err && err.status) || 500).json({ error: "something broke on our side" });
});
