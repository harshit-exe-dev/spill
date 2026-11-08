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
  const socketRef = useRef(null);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3200);
  };

  const loadFeed = () => api.feed(sort).then(setPosts).catch(() => {});
  const loadIncoming = () => api.incoming().then(setIncoming).catch(() => {});
  const loadThreads = () => api.threads().then(setThreads).catch(() => {});

  const boot = () => {
    api.me().then(({ user, phrase }) => {
      setMe(user);
      if (phrase) setNewPhrase(phrase);
      const socket = io(API_URL);
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("identify", getToken()));
      socket.on("presence", (d) => setOnline(d.online || 0));
      socket.on("request:new", () => { loadIncoming(); flash("Someone wants to talk privately 👀"); });
      socket.on("request:accepted", () => { loadThreads(); flash("They said yes!! Your chat is open"); });
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
    }).catch(() => flash("Couldn't reach the server — is the API awake?"));
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
    return <div className="boot">spill<span className="dot-inline">.</span></div>;
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
          <button className={`nav-link ${view === "chats" || view === "chat" ? "active" : ""}`} onClick={() => setView("chats")}>
            Chats{incoming.length > 0 && <span className="badge">{incoming.length}</span>}
          </button>
          <button className="me-chip as-button" title="Your profile" onClick={() => setShowProfile(true)}>
            <Handle handle={me.handle} color={me.color} />
            <span className="chip-caret">▾</span>
          </button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

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
