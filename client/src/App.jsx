import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "./api";
import { API_URL } from "./config";

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
  const socketRef = useRef(null);

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3200);
  };

  const loadFeed = () => api.feed(sort).then(setPosts).catch(() => {});
  const loadIncoming = () => api.incoming().then(setIncoming).catch(() => {});
  const loadThreads = () => api.threads().then(setThreads).catch(() => {});

  useEffect(() => {
    api.me().then((user) => {
      setMe(user);
      const socket = io(API_URL);
      socketRef.current = socket;
      socket.on("connect", () => socket.emit("identify", getToken()));
      socket.on("request:new", () => { loadIncoming(); flash("Someone wants to talk privately"); });
      socket.on("request:accepted", () => { loadThreads(); flash("They said yes — you can talk now"); });
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
  }, []);

  useEffect(() => { if (me) loadFeed(); }, [me, sort]);
  useEffect(() => { if (me && view === "chats") { loadIncoming(); loadThreads(); } }, [me, view]);

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
      .then((d) => flash(d.status === "accepted" ? "You already talk with them — check Chats" : "Request sent. If they say yes, a chat opens."))
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
          <span className="me-chip" title="This is the only name anyone sees">
            <Handle handle={me.handle} color={me.color} />
            <button className="reroll" title="Re-roll my name"
              onClick={() => api.reroll().then((u) => { setMe(u); flash(`You are now ${u.handle}`); })}>
              ↻
            </button>
          </span>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

      <main>
        {view === "feed" && (
          <Feed
            me={me} posts={posts} sort={sort} setSort={setSort}
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

function Feed({ me, posts, sort, setSort, reload, openPost, talkPrivately, flash }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    api.post(text)
      .then(() => { setText(""); reload(); })
      .catch((e) => flash(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <p className="eyebrow">The campus wall · no names, no judgement</p>
      <h1><span className="grey">Same campus.</span>Everything unsaid.</h1>
      <p className="sub">
        Confess it, rant it, ask it. You're a random name here —{" "}
        <b>{me.handle}</b> — and so is everyone else.
      </p>

      <div className="compose card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 600))}
          placeholder="Say the thing you'd never say out loud…"
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
        <button className={sort === "new" ? "pill active" : "pill"} onClick={() => setSort("new")}>Newest</button>
        <button className={sort === "top" ? "pill active" : "pill"} onClick={() => setSort("top")}>Most loved</button>
      </div>

      {posts.map((post) => (
        <PostCard key={post.id} post={post} me={me} openPost={openPost} talkPrivately={talkPrivately} flash={flash} />
      ))}
      {posts.length === 0 && <p className="empty">Nothing here yet. Yours could be the first voice on the wall.</p>}
    </>
  );
}

function PostCard({ post, me, openPost, talkPrivately, flash }) {
  const [hearts, setHearts] = useState(post.hearts);
  const [hearted, setHearted] = useState(false);
  const mine = post.authorId === me.id;

  const heart = () =>
    api.heart(post.id).then((d) => { setHearts(d.hearts); setHearted(d.hearted); }).catch(() => {});

  const report = () =>
    api.report(post.id).then(() => flash("Reported. Three reports hide a post automatically.")).catch(() => {});

  return (
    <article className="card post">
      <div className="post-head">
        <Handle handle={post.handle} color={post.color} />
        <span className="time">{timeAgo(post.createdAt)}</span>
      </div>
      <p className="post-text" onClick={() => openPost(post.id)}>{post.text}</p>
      <div className="post-actions">
        <button className={`act ${hearted ? "on" : ""}`} onClick={heart}>♥ {hearts}</button>
        <button className="act" onClick={() => openPost(post.id)}>💬 {post.replyCount} replies</button>
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
        {!mine && (
          <div className="post-actions">
            <button className="act strong" onClick={() => talkPrivately(post)}>Talk privately</button>
          </div>
        )}
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
      {replies.length === 0 && <p className="empty">No replies yet. Say the first kind thing.</p>}

      <div className="compose card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 400))}
          placeholder={`Reply as ${me.handle}…`}
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
        <p className="empty">No conversations yet. When a confession hits home, tap “Talk privately” on it.</p>
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
        <span className="time">still a random name, even here</span>
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
