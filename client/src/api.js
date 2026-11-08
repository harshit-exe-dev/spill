import { API_URL } from "./config";

export function getToken() {
  return localStorage.getItem("spill-token") || "";
}

async function call(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-token": getToken(),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "something went wrong");
  return data;
}

export const api = {
  // resolves { user, phrase } — phrase is set only the one time an
  // account is created (or first upgraded), so the app can show it once
  me: () =>
    call("/api/me", {
      method: "POST",
      body: JSON.stringify({ token: getToken() }),
    }).then((d) => {
      localStorage.setItem("spill-token", d.token);
      return { user: d.user, phrase: d.phrase || null };
    }),
  recover: (phrase) =>
    call("/api/me/recover", {
      method: "POST",
      body: JSON.stringify({ phrase }),
    }).then((d) => {
      localStorage.setItem("spill-token", d.token);
      return d.user;
    }),
  reroll: () => call("/api/me/reroll", { method: "POST" }).then((d) => d.user),
  feed: (sort) => call(`/api/feed?sort=${sort}`).then((d) => d.posts),
  post: (text) => call("/api/posts", { method: "POST", body: JSON.stringify({ text }) }),
  getPost: (id) => call(`/api/posts/${id}`),
  reply: (id, text) =>
    call(`/api/posts/${id}/replies`, { method: "POST", body: JSON.stringify({ text }) }),
  heart: (id) => call(`/api/posts/${id}/heart`, { method: "POST" }),
  report: (id) => call(`/api/posts/${id}/report`, { method: "POST" }),
  requestChat: (toUserId, postId) =>
    call("/api/requests", { method: "POST", body: JSON.stringify({ toUserId, postId }) }),
  incoming: () => call("/api/requests").then((d) => d.incoming),
  actOnRequest: (id, action) => call(`/api/requests/${id}/${action}`, { method: "POST" }),
  threads: () => call("/api/threads").then((d) => d.threads),
  messages: (userId) => call(`/api/threads/${userId}/messages`),
};
