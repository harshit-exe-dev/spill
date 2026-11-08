import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "./api";
import { API_URL } from "./config";

export const REACTIONS = [
  { kind: "heart", emoji: "❤️" },
  { kind: "fire", emoji: "🔥" },
  { kind: "cry", emoji: "😭" },
  { kind: "skull", emoji: "💀" },
];

export function Reactions({ post, onReact }) {
  const [data, setData] = useState(post.reactions);
  useEffect(() => setData(post.reactions), [post.id]);
  const hit = (kind) => {
    setData((d) => ({
      counts: { ...d.counts, [kind]: d.counts[kind] + (d.mine[kind] ? -1 : 1) },
      mine: { ...d.mine, [kind]: !d.mine[kind] },
    }));
    onReact(post.id, kind).then(setData).catch(() => setData(post.reactions));
  };
  return (
    <>
      {REACTIONS.map(({ kind, emoji }) => (
        <button
          key={kind}
          className={`act react ${kind} ${data.mine[kind] ? "on" : ""}`}
          onClick={() => hit(kind)}
        >
          <span className="rx-emoji" key={data.counts[kind]}>{emoji}</span> {data.counts[kind]}
        </button>
      ))}
    </>
  );
}

function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Handle({ handle, color }) {
  return (
    <span className="handle">
      <span className="dot" style={{ background: color }} />
      {handle}
    </span>
  );
}

// ---------- notifications ----------

function noteIcon(n) {
  if (n.type === "reply") return "💬";
  if (n.type === "request") return "👀";
  if (n.type === "accepted") return "💚";
  if (n.type === "message") return "✉️";
  if (n.type === "reaction") return n.emoji || "❤️";
  return "🔔";
}

function noteVerb(n) {
  if (n.type === "reply") return "replied to your spill";
  if (n.type === "request") return "wants to talk privately";
  if (n.type === "accepted") return "said yes — your chat is open";
  if (n.type === "message") return "sent you a message";
  if (n.type === "reaction") return "reacted to your spill";
  return "did something";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function NotesPanel({ notes, pushState, enablePush, disablePush, goNote, close }) {
  return (
    <div className="modal-wrap" onClick={close}>
      <div className="modal card sheet notes-panel" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <div className="sheet-name">Notifications</div>
            <div className="sheet-sub">everything that happened while you were gone</div>
          </div>
        </div>

        {pushState === "off" && (
          <button className="sheet-row" onClick={enablePush}>
            <span>🔔 Ping this device too — even with the tab closed</span><span className="sheet-arrow">→</span>
          </button>
        )}
        {pushState === "on" && (
          <button className="sheet-row" onClick={disablePush}>
            <span>✅ Device pings are on</span><span className="sheet-arrow">turn off</span>
          </button>
        )}
        {pushState === "blocked" && (
          <p className="sheet-note">Device pings are blocked in this browser's settings — the bell still catches everything.</p>
        )}

        {notes.map((n) => (
          <button key={n.id} className={`note-row ${n.read ? "" : "unread"}`} onClick={() => goNote(n)}>
            <span className="note-icon">{noteIcon(n)}</span>
            <span className="note-main">
              <span className="note-line">
                {n.actorHandle && <span className="dot" style={{ background: n.actorColor || "#999" }} />}
                <b>{n.actorHandle || "Someone"}</b>&nbsp;{noteVerb(n)}
                {!n.read && <span className="note-dot" />}
              </span>
              {n.text && n.type !== "accepted" && <span className="note-preview">{n.text}</span>}
            </span>
            <span className="time">{timeAgo(n.createdAt)}</span>
          </button>
        ))}
        {notes.length === 0 && (
          <p className="empty">All quiet. No replies, no requests — yet.</p>
        )}
        <button className="act ghost center" onClick={close}>Close</button>
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [view, setView] = useState("feed"); // feed | post | chats | chat
  const [sort, setSort] = useState("new");
  const [posts, setPosts] = useState([]);
  const [openPost, setOpenPost] = useState(null); // {post, replies}
  const [incoming, setIncoming] = useState([]);
  const [threads, setThreads] = useState([]);
  const [chatWith, setChatWith] = useState(null); // {with, messages}
  const [notice, setNotice] = useState("");
  const [newPhrase, setNewPhrase] = useState(null); // shown exactly once
  const [showLogin, setShowLogin] = useState(false);
  const [showName, setShowName] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [online, setOnline] = useState(0);
  const [loggedOut, setLoggedOut] = useState(() => localStorage.getItem("spill-out") === "1");
  const [notes, setNotes] = useState([]);
  const [unread, setUnread] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [pushState, setPushState] = useState("unknown"); // unknown | off | on | blocked | unsupported
  const [showPushAsk, setShowPushAsk] = useState(false);
  const [bootWait, setBootWait] = useState(0); // failed boot attempts so far
  const bootTriesRef = useRef(0);
  const socketRef = useRef(null);
  const openChatRef = useRef(null); // user id of the chat on screen, if any

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3200);
  };

  const pushToast = (note) => {
    setToasts((t) => [...t.slice(-2), note]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== note.id)), 5200);
  };

  const loadFeed = () => api.feed(sort).then(setPosts).catch(() => {});
  const loadIncoming = () => api.incoming().then(setIncoming).catch(() => {});
  const loadThreads = () => api.threads().then(setThreads).catch(() => {});

  const refreshPushState = async () => {
    if (!("PushManager" in window) || !("serviceWorker" in navigator) || !("Notification" in window)) {
      setPushState("unsupported");
      return;
    }
    if (Notification.permission === "denied") { setPushState("blocked"); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      setPushState(sub ? "on" : "off");
    } catch (e) { setPushState("off"); }
  };

  const boot = () => {
    // The server naps when nobody's around (free tier) and can take a
    // minute to wake up, so one failed reach must not be the end of the
    // story: race a 15s clock, and keep knocking for a while instead of
    // dying silently on the splash screen.
    const meWithTimeout = Promise.race([
      api.me(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("too slow")), 15000)),
    ]);
    meWithTimeout.then(({ user, phrase }) => {
      bootTriesRef.current = 0;
      setBootWait(0);
      setMe(user);
      if (phrase) setNewPhrase(phrase);
      api.notifications().then((d) => { setNotes(d.notifications); setUnread(d.unread); }).catch(() => {});
      refreshPushState();
      const socket = io(API_URL);
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("identify", getToken()));
      socket.on("presence", (d) => setOnline(d.online || 0));
      socket.on("request:new", () => loadIncoming());
      socket.on("request:accepted", () => loadThreads());
      socket.on("notification:new", (note) => {
        // already staring at this chat? then it's read the second it lands
        if (note.type === "message" && openChatRef.current === note.withUserId) {
          api.markRead({ ids: [note.id] }).catch(() => {});
          setNotes((list) => [{ ...note, read: true },
            ...list.filter((x) => x.id !== note.id)].slice(0, 40));
          return;
        }
        setNotes((list) => [note, ...list.filter((x) => x.id !== note.id)].slice(0, 40));
        setUnread((n) => n + 1);
        pushToast(note);
        if (note.type === "request") loadIncoming();
        if (note.type === "accepted") loadThreads();
      });
      socket.on("dm:new", (msg) => {
        setChatWith((current) => {
          if (current && (msg.fromId === current.with.id || msg.fromId === user.id)) {
            return { ...current, messages: [...current.messages, {
              id: msg.id, mine: msg.fromId === user.id, text: msg.text, createdAt: msg.createdAt,
            }] };
          }
          return current;
        });
        loadThreads();
      });
    }).catch(() => {
      bootTriesRef.current += 1;
      setBootWait(bootTriesRef.current);
      if (bootTriesRef.current <= 8) setTimeout(boot, 7000);
    });
  };

  useEffect(() => { if (!loggedOut) boot(); }, []);

  const logout = () => {
    localStorage.removeItem("spill-token");
    localStorage.setItem("spill-out", "1");
    if (socketRef.current) socketRef.current.disconnect();
    setShowProfile(false);
    setMe(null);
    setLoggedOut(true);
  };

  const startFresh = () => {
    localStorage.removeItem("spill-out");
    setLoggedOut(false);
    boot();
  };

  useEffect(() => { if (me) loadFeed(); }, [me, sort]);
  useEffect(() => { if (me && view === "chats") { loadIncoming(); loadThreads(); } }, [me, view]);
  useEffect(() => {
    openChatRef.current = view === "chat" && chatWith ? chatWith.with.id : null;
  }, [view, chatWith]);

  const openNotes = () => {
    setShowNotes(true);
    if (unread > 0) {
      api.markRead({ all: true }).catch(() => {});
      setUnread(0);
      setNotes((list) => list.map((n) => ({ ...n, read: true })));
    }
  };

  const goNote = (note) => {
    setShowNotes(false);
    setToasts((t) => t.filter((x) => x.id !== note.id));
    if (!note.read) {
      api.markRead({ ids: [note.id] }).catch(() => {});
      setUnread((n) => Math.max(0, n - 1));
      setNotes((list) => list.map((x) => (x.id === note.id ? { ...x, read: true } : x)));
    }
    if ((note.type === "reply" || note.type === "reaction") && note.postId) openPostView(note.postId);
    else if (note.type === "request") { setView("chats"); loadIncoming(); loadThreads(); }
    else if ((note.type === "accepted" || note.type === "message") && note.withUserId) openChat(note.withUserId);
  };

  // The browser's own permission dialog is cold and a little scary, so
  // it never fires out of nowhere: once you're in and settled, our own
  // card asks first — nicely, in our voice — and the system dialog only
  // shows if you tap yes. Say nah once and we never bring it up again
  // (the bell panel keeps a quiet manual switch either way).
  useEffect(() => {
    if (!me || newPhrase || pushState !== "off") return;
    if (!("Notification" in window) || Notification.permission === "denied") return;
    if (localStorage.getItem("spill-push-asked")) return;
    const timer = setTimeout(() => setShowPushAsk(true), 1800);
    return () => clearTimeout(timer);
  }, [me, newPhrase, pushState]);

  const dismissPushAsk = () => {
    localStorage.setItem("spill-push-asked", "1");
    setShowPushAsk(false);
  };

  const acceptPushAsk = () => {
    dismissPushAsk();
    enablePush();
  };

  const enablePush = async () => {
    localStorage.setItem("spill-push-asked", "1");
    try {
      const key = await api.pushKey();
      if (!key) { flash("Push isn't switched on at the server yet"); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setPushState("blocked"); flash("Notifications are blocked in the browser settings"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      await api.pushSubscribe(sub.toJSON());
      setPushState("on");
      flash("Device notifications on — we'll ping you here too");
    } catch (e) {
      flash("Couldn't turn push on in this browser");
    }
  };

  const disablePush = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setPushState("off");
      flash("Device notifications off. The bell still keeps everything.");
    } catch (e) { /* already off, effectively */ setPushState("off"); }
  };

  if (loggedOut && !me) {
    return (
      <>
        <div className="out-screen">
          <div className="logo big">spill<span className="dot-inline">.</span></div>
          <h1><span className="grey">Logged out.</span>Peace.</h1>
          <p className="sub">
            Your name and your chats are exactly where you left them — if you
            kept your login phrase. No phrase, no way back. That's the deal
            with anonymous.
          </p>
          <div className="out-actions">
            <button className="cta" onClick={() => setShowLogin(true)}>Log in with my phrase</button>
            <button className="pill" onClick={startFresh}>Start fresh instead</button>
          </div>
        </div>
        {showLogin && (
          <LoginModal
            close={() => setShowLogin(false)}
            done={() => { localStorage.removeItem("spill-out"); window.location.reload(); }}
            flash={flash}
          />
        )}
        {notice && <div className="notice">{notice}</div>}
      </>
    );
  }

  if (!me) {
    return (
      <div className="boot">
        <div>spill<span className="dot-inline">.</span></div>
        {bootWait > 0 && (
          <div className="boot-wait">
            <p>
              {bootWait <= 8
                ? "Waking the server up — it naps when nobody's around. Hang tight a few seconds…"
                : "The server's taking unusually long. Check your connection, then tap retry."}
            </p>
            {bootWait > 2 && (
              <button
                className="cta"
                onClick={() => { bootTriesRef.current = 0; setBootWait(0); boot(); }}
              >
                Retry now
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const openPostView = (id) => {
    api.getPost(id).then((d) => { setOpenPost(d); setView("post"); }).catch(() => flash("That post is gone"));
  };

  const openChat = (userId) => {
    api.messages(userId).then((d) => { setChatWith(d); setView("chat"); })
      .catch((e) => flash(e.message));
  };

  const talkPrivately = (post) => {
    api.requestChat(post.authorId, post.id)
      .then((d) => flash(d.status === "accepted" ? "You already talk with them — check Chats" : "Shot sent 🎯 If they say yes, a chat opens."))
      .catch((e) => flash(e.message));
  };

  return (
    <>
      <div className="nav">
        <button className="logo" onClick={() => setView("feed")}>spill<span className="dot-inline">.</span></button>
        <div className="nav-right">
          <button className="bell" title="Notifications" onClick={openNotes}>
            🔔{unread > 0 && <span className="badge bell-badge">{unread}</span>}
          </button>
          <button className={`nav-link ${view === "chats" || view === "chat" ? "active" : ""}`} onClick={() => setView("chats")}>
            Chats{incoming.length > 0 && <span className="badge">{incoming.length}</span>}
          </button>
          <button className="me-chip as-button" title="Your profile" onClick={() => setShowProfile(true)}>
            <span className="handle">
              <span className="dot" style={{ background: me.color }} />
              <span className="handle-name">{me.handle}</span>
            </span>
            <span className="chip-caret">▾</span>
          </button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

      {toasts.length > 0 && (
        <div className="toast-stack">
          {toasts.map((n) => (
            <button key={n.id} className="toast" onClick={() => goNote(n)}>
              <span className="toast-icon">{noteIcon(n)}</span>
              <span className="toast-text"><b>{n.actorHandle || "Someone"}</b> {noteVerb(n)}</span>
            </button>
          ))}
        </div>
      )}

      {showPushAsk && !newPhrase && (
        <div className="push-ask card">
          <div className="push-ask-icon">🔔</div>
          <div className="push-ask-main">
            <div className="push-ask-title">Don't miss the plot twists 👀</div>
            <p className="push-ask-text">
              Someone replies to your spill, wants to talk, or slides into
              your DMs — wanna get pinged even when the tab's closed?
            </p>
            <div className="push-ask-actions">
              <button className="cta" onClick={acceptPushAsk}>Yes, ping me</button>
              <button className="act ghost" onClick={dismissPushAsk}>Nah, I'm good</button>
            </div>
          </div>
          <button className="push-ask-x" onClick={dismissPushAsk} title="Not now">✕</button>
        </div>
      )}

      {showNotes && (
        <NotesPanel
          notes={notes}
          pushState={pushState}
          enablePush={enablePush}
          disablePush={disablePush}
          goNote={goNote}
          close={() => setShowNotes(false)}
        />
      )}

      {newPhrase && (
        <div className="modal-wrap">
          <div className="modal card">
            <p className="eyebrow small">Your way back in</p>
            <h2 className="modal-title">Screenshot this phrase.</h2>
            <p className="sub">
              There's no email or password here. This phrase is the <b>only</b> way
              back into <b>{me.handle}</b> — your chats included — on a new phone
              or browser. Lose it and the account can't be recovered.
            </p>
            <div className="phrase">{newPhrase}</div>
            <button className="cta wide" onClick={() => setNewPhrase(null)}>I saved it</button>
          </div>
        </div>
      )}

      {showProfile && (
        <ProfileSheet
          me={me}
          close={() => setShowProfile(false)}
          editName={() => { setShowProfile(false); setShowName(true); }}
          switchAccount={() => { setShowProfile(false); setShowLogin(true); }}
          logout={logout}
        />
      )}

      {showName && (
        <NameModal
          me={me}
          close={() => setShowName(false)}
          done={(u) => { setMe(u); setShowName(false); flash(`Name secured — you're ${u.handle} now`); }}
          random={() => api.reroll().then((u) => { setMe(u); setShowName(false); flash(`New era unlocked: ${u.handle}`); })}
        />
      )}

      {showLogin && (
        <LoginModal
          close={() => setShowLogin(false)}
          done={(user) => { setShowLogin(false); flash(`Welcome back, ${user.handle}`); window.location.reload(); }}
          flash={flash}
        />
      )}

      <main key={view + (openPost ? openPost.post.id : "")} className="view-enter">
        {view === "feed" && (
          <Feed
            me={me} posts={posts} sort={sort} setSort={setSort} online={online}
            reload={loadFeed} openPost={openPostView}
            talkPrivately={talkPrivately} flash={flash}
          />
        )}
        {view === "post" && openPost && (
          <PostView
            me={me} data={openPost} back={() => { setView("feed"); loadFeed(); }}
            reload={() => openPostView(openPost.post.id)}
            talkPrivately={talkPrivately} flash={flash}
          />
        )}
        {view === "chats" && (
          <Chats
            incoming={incoming} threads={threads}
            act={(id, action) => api.actOnRequest(id, action).then(() => { loadIncoming(); loadThreads(); })}
            openChat={openChat} openPost={openPostView}
          />
        )}
        {view === "chat" && chatWith && (
          <ChatView
            data={chatWith} back={() => setView("chats")}
            send={(text) => socketRef.current && socketRef.current.emit("dm:send", { toUserId: chatWith.with.id, text })}
          />
        )}
      </main>

      <footer className="foot">
        No real names here, ever. Be kind — the person you're reading could be sitting next to you in the library.
      </footer>
    </>
  );
}

function ProfileSheet({ me, close, editName, switchAccount, logout }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="modal-wrap" onClick={close}>
      <div className="modal card sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="avatar-dot" style={{ background: me.color }} />
          <div>
            <div className="sheet-name">{me.handle}</div>
            <div className="sheet-sub">that's you on the wall</div>
          </div>
        </div>
        <button className="sheet-row" onClick={editName}>
          <span>✏️ Edit my name</span><span className="sheet-arrow">→</span>
        </button>
        <button className="sheet-row" onClick={switchAccount}>
          <span>🔑 Log in as someone else</span><span className="sheet-arrow">→</span>
        </button>
        {!confirming ? (
          <button className="sheet-row danger" onClick={() => setConfirming(true)}>
            <span>🚪 Log out</span><span className="sheet-arrow">→</span>
          </button>
        ) : (
          <button className="sheet-row danger confirm" onClick={logout}>
            <span>Tap again to log out — phrase saved?</span>
          </button>
        )}
        <p className="sheet-note">
          Your login phrase is the only way back into this name and your
          chats. Logged out without it = gone forever. No pressure.
        </p>
        <button className="act ghost center" onClick={close}>Close</button>
      </div>
    </div>
  );
}

function NameModal({ me, close, done, random }) {
  const [name, setName] = useState(me.handle);
  const [status, setStatus] = useState(""); // "", "checking", "free", or an error line
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  // check as they type, so "already taken" shows up before they save
  const check = (value) => {
    setName(value);
    clearTimeout(timer.current);
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === me.handle.toLowerCase()) { setStatus(""); return; }
    setStatus("checking");
    timer.current = setTimeout(() => {
      api.nameAvailable(trimmed)
        .then((d) => setStatus(d.available ? "free" : d.reason))
        .catch(() => setStatus(""));
    }, 450);
  };

  const save = () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    api.setName(name.trim())
      .then(done)
      .catch((e) => { setStatus(e.message); setBusy(false); });
  };

  const taken = status && status !== "checking" && status !== "free";

  return (
    <div className="modal-wrap" onClick={close}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow small">Your name here</p>
        <h2 className="modal-title">Write your own name.</h2>
        <p className="sub">Anything you like — except someone else's real name. 2–20 characters: letters, numbers, spaces, underscore.</p>
        <input
          className="phrase-input"
          value={name}
          onChange={(e) => check(e.target.value.slice(0, 24))}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. Night Owl"
          autoFocus
        />
        {status === "checking" && <p className="name-status">Checking…</p>}
        {status === "free" && <p className="name-status ok">That one's free — it's yours if you save it.</p>}
        {taken && <p className="name-status bad">{status}</p>}
        <button className="cta wide" onClick={save} disabled={busy || !name.trim() || taken}>
          Save my name
        </button>
        <button className="act ghost center" onClick={random}>Surprise me instead (random name)</button>
        <button className="act ghost center" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function LoginModal({ close, done, flash }) {
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!phrase.trim() || busy) return;
    setBusy(true);
    api.recover(phrase)
      .then(done)
      .catch((e) => { flash(e.message); setBusy(false); });
  };

  return (
    <div className="modal-wrap" onClick={close}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow small">Log back in</p>
        <h2 className="modal-title">Your five words.</h2>
        <p className="sub">Type the login phrase you saved when this name was born. Order matters, spelling doesn't shout — lowercase is fine.</p>
        <input
          className="phrase-input"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. panda river tiger cloud mango"
          autoFocus
        />
        <button className="cta wide" onClick={submit} disabled={busy || !phrase.trim()}>
          Bring my name back
        </button>
        <button className="act ghost center" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

function Feed({ me, posts, sort, setSort, online, reload, openPost, talkPrivately, flash }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    api.post(text)
      .then(() => { setText(""); reload(); flash("It's on the wall. No take-backs."); })
      .catch((e) => flash(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <p className="eyebrow">The campus wall · no names, no judgement</p>
      <h1><span className="grey">Same campus.</span>Everything unsaid.</h1>
      <p className="sub">
        Confess it, rant it, ask it. Here you're <b>{me.handle}</b> — a name
        you picked or the dice gave you — and that's all anyone knows.
      </p>
      {online > 0 && (
        <div className="presence"><span className="live-dot" />{online} here rn</div>
      )}

      <div className="compose card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 600))}
          placeholder="Spill the tea… it stays anonymous, promise"
          rows={3}
        />
        <div className="compose-row">
          <span className="count">{text.length}/600</span>
          <button className="cta" onClick={submit} disabled={busy || text.trim().length < 3}>
            Spill it
          </button>
        </div>
      </div>

      <div className="sort-row">
        <button className={sort === "new" ? "pill active" : "pill"} onClick={() => setSort("new")}>Fresh</button>
        <button className={sort === "top" ? "pill active" : "pill"} onClick={() => setSort("top")}>Top vibes</button>
      </div>

      {posts.map((post, i) => (
        <PostCard key={post.id} post={post} me={me} index={i} openPost={openPost} talkPrivately={talkPrivately} flash={flash} />
      ))}
      {posts.length === 0 && <p className="empty">it's giving… empty. drop the first spill 👇</p>}
    </>
  );
}

function PostCard({ post, me, index, openPost, talkPrivately, flash }) {
  const mine = post.authorId === me.id;

  const report = () =>
    api.report(post.id).then(() => flash("Reported. Three reports and it's gone.")).catch(() => {});

  return (
    <article className="card post rise" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="post-head">
        <Handle handle={post.handle} color={post.color} />
        <span className="time">{timeAgo(post.createdAt)}</span>
      </div>
      <p className="post-text" onClick={() => openPost(post.id)}>{post.text}</p>
      <div className="post-actions">
        <Reactions post={post} onReact={api.react} />
        <button className="act" onClick={() => openPost(post.id)}>💬 {post.replyCount}</button>
        {!mine && <button className="act strong" onClick={() => talkPrivately(post)}>Talk privately</button>}
        {!mine && <button className="act ghost" onClick={report}>Report</button>}
      </div>
    </article>
  );
}

function PostView({ me, data, back, reload, talkPrivately, flash }) {
  const { post, replies } = data;
  const [text, setText] = useState("");
  const mine = post.authorId === me.id;

  const submit = () => {
    if (!text.trim()) return;
    api.reply(post.id, text).then(() => { setText(""); reload(); }).catch((e) => flash(e.message));
  };

  return (
    <>
      <button className="back" onClick={back}>← Back to the wall</button>
      <article className="card post big">
        <div className="post-head">
          <Handle handle={post.handle} color={post.color} />
          <span className="time">{timeAgo(post.createdAt)}</span>
        </div>
        <p className="post-text">{post.text}</p>
        <div className="post-actions">
          <Reactions post={post} onReact={api.react} />
          {!mine && <button className="act strong" onClick={() => talkPrivately(post)}>Talk privately</button>}
        </div>
      </article>

      <p className="eyebrow small">{replies.length} public replies</p>
      {replies.map((r) => (
        <div key={r.id} className="card reply">
          <div className="post-head">
            <Handle handle={r.handle} color={r.color} />
            <span className="time">{timeAgo(r.createdAt)}</span>
          </div>
          <p className="post-text">{r.text}</p>
        </div>
      ))}
      {replies.length === 0 && <p className="empty">No replies yet. Be the first to say something real.</p>}

      <div className="compose card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 400))}
          placeholder={`Add your two cents as ${me.handle}…`}
          rows={2}
        />
        <div className="compose-row">
          <span className="count">{text.length}/400</span>
          <button className="cta" onClick={submit} disabled={!text.trim()}>Reply</button>
        </div>
      </div>
    </>
  );
}

function Chats({ incoming, threads, act, openChat, openPost }) {
  return (
    <>
      <p className="eyebrow">Private talk</p>
      <h1><span className="grey">Only if</span>both say yes.</h1>
      <p className="sub">Nobody can message you out of nowhere here. A request comes in, you choose, and only then does a chat exist.</p>

      {incoming.length > 0 && (
        <>
          <p className="eyebrow small">Wants to talk to you</p>
          {incoming.map((r) => (
            <div key={r.id} className="card request">
              <Handle handle={r.from.handle} color={r.from.color} />
              <div className="request-actions">
                {r.postId && <button className="act" onClick={() => openPost(r.postId)}>See the post</button>}
                <button className="act" onClick={() => act(r.id, "decline")}>Decline</button>
                <button className="cta small" onClick={() => act(r.id, "accept")}>Accept</button>
              </div>
            </div>
          ))}
        </>
      )}

      <p className="eyebrow small">Your conversations</p>
      {threads.map((t) => (
        <button key={t.with.id} className="card thread" onClick={() => openChat(t.with.id)}>
          <Handle handle={t.with.handle} color={t.with.color} />
          <span className="thread-last">{t.last ? t.last.text : "Say the first hello"}</span>
        </button>
      ))}
      {threads.length === 0 && incoming.length === 0 && (
        <p className="empty">No convos yet. When a spill hits home, shoot your shot from the post.</p>
      )}
    </>
  );
}

function ChatView({ data, back, send }) {
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current && bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [data.messages]);

  const submit = () => {
    if (!text.trim()) return;
    send(text.trim());
    setText("");
  };

  return (
    <>
      <button className="back" onClick={back}>← All chats</button>
      <div className="chat-head card">
        <Handle handle={data.with.handle} color={data.with.color} />
        <span className="time">names stay fake here. vibes stay real.</span>
      </div>
      <div className="chat-body">
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.mine ? "mine" : "theirs"}`}>{m.text}</div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input">
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 1000))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Message…"
        />
        <button className="cta" onClick={submit} disabled={!text.trim()}>Send</button>
      </div>
    </>
  );
}
