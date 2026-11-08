const webpush = require("web-push");
const { Notification, PushSubscription } = require("./models");

// Browser push, the self-hosted way: VAPID keys we generated ourselves,
// no push service in the middle, nothing paid. If the keys aren't in
// the environment, push quietly disables itself and the in-app bell
// still works.
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const pushReady = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushReady) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:imailharshitbharti@gmail.com",
    VAPID_PUBLIC,
    VAPID_PRIVATE
  );
}

const TITLES = {
  reply: "New reply on your spill",
  request: "Someone wants to talk",
  accepted: "They said yes",
  message: "New message",
  reaction: "Your spill got some love",
};

function notificationJson(n) {
  return {
    id: n._id,
    type: n.type,
    actorHandle: n.actorHandle || null,
    actorColor: n.actorColor || null,
    postId: n.post || null,
    withUserId: n.withUser || null,
    emoji: n.emoji || null,
    text: n.text || "",
    read: Boolean(n.read),
    createdAt: n.createdAt,
  };
}

async function sendPush(userId, note) {
  if (!pushReady) return;
  const subs = await PushSubscription.find({ user: userId }).lean();
  if (!subs.length) return;
  const payload = JSON.stringify({
    title: TITLES[note.type] || "Spill",
    body: note.actorHandle
      ? `${note.actorHandle}: ${note.text || ""}`.trim()
      : note.text || "",
    postId: note.post ? String(note.post) : null,
    withUserId: note.withUser ? String(note.withUser) : null,
    type: note.type,
  });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 } // an hour of trying is plenty for gossip
      );
    } catch (err) {
      // 404/410 means that browser is gone for good — stop writing to it
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
      }
    }
  }));
}

// One door for every "tell this person" moment: save it for the bell,
// ping their open tabs over the socket, and push to their browser if
// they've allowed it. Message and reaction notes fold into an existing
// unread one, so a busy chat doesn't bury the bell in duplicates.
function makeNotify(app) {
  return async function notify(userId, data) {
    try {
      if (!userId || String(userId) === String(data.actorId || "")) return;
      const foldable = data.type === "message" || data.type === "reaction";
      let note = null;
      if (foldable) {
        const query = { user: userId, type: data.type, read: false };
        if (data.type === "message") query.withUser = data.withUser;
        if (data.type === "reaction") query.post = data.post;
        note = await Notification.findOne(query).sort({ createdAt: -1 });
      }
      if (note) {
        note.actorHandle = data.actorHandle;
        note.actorColor = data.actorColor;
        note.emoji = data.emoji || note.emoji;
        note.text = data.text || note.text;
        note.createdAt = new Date(); // bump to the top of the bell
        await note.save();
      } else {
        note = await Notification.create({
          user: userId,
          type: data.type,
          actorHandle: data.actorHandle,
          actorColor: data.actorColor,
          post: data.post,
          withUser: data.withUser,
          emoji: data.emoji,
          text: data.text,
        });
      }
      const json = notificationJson(note);
      app.get("notify")(userId, "notification:new", json);
      sendPush(userId, note).catch(() => {});
      return json;
    } catch (err) {
      // a failed notification must never fail the thing it reports on
      return null;
    }
  };
}

module.exports = { makeNotify, notificationJson, pushReady, VAPID_PUBLIC };
