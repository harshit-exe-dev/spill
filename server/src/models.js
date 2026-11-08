const mongoose = require("mongoose");

// Nobody signs up with a real name here. The server hands out a random
// handle (QuietPanda42 and friends) tied to a private device token.
// The token never leaves the browser that created it, and the handle
// is the only identity anyone ever sees.
const userSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  handle: { type: String, required: true, trim: true, maxlength: 30 },
  color: { type: String, required: true, default: "#ff5a1f" },
  // The way back in. Every account gets a 5-word login phrase; only its
  // hash lives here. Show the phrase once, and whoever holds it can
  // recover the account on any device — no email, no phone, no name.
  recoveryHash: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  handle: { type: String, required: true },
  color: { type: String, required: true },
  text: { type: String, required: true, trim: true, maxlength: 600 },
  hearts: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  replyCount: { type: Number, default: 0 },
  reports: { type: Number, default: 0 },
  reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  hidden: { type: Boolean, default: false }, // auto-hidden after repeat reports
  createdAt: { type: Date, default: Date.now, index: true },
});

const replySchema = new mongoose.Schema({
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  handle: { type: String, required: true },
  color: { type: String, required: true },
  text: { type: String, required: true, trim: true, maxlength: 400 },
  createdAt: { type: Date, default: Date.now },
});

// A private talk starts only when one person asks and the other says
// yes. Until then, nobody can message anybody — that's the whole rule.
const chatRequestSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  post: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
  status: { type: String, enum: ["pending", "accepted", "declined"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

const messageSchema = new mongoose.Schema({
  thread: { type: String, required: true, index: true }, // the two user ids, sorted, joined
  from: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
  createdAt: { type: Date, default: Date.now },
});

module.exports = {
  User: mongoose.model("User", userSchema),
  Post: mongoose.model("Post", postSchema),
  Reply: mongoose.model("Reply", replySchema),
  ChatRequest: mongoose.model("ChatRequest", chatRequestSchema),
  Message: mongoose.model("Message", messageSchema),
};
