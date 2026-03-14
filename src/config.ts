const envUrl = typeof import.meta !== "undefined"
  ? (import.meta as any).env?.VITE_BACKEND_URL
  : undefined;

export const BACKEND_URL: string = envUrl || "http://localhost:8000";

export const api = {
  addAccount: async (phone: string, label: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/accounts/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
        body: JSON.stringify({ phone, label })
      });
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  confirmAccount: async (phone: string, code: string, password = "") => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/accounts/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
        body: JSON.stringify({ phone, code, password })
      });
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  getAccounts: async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/accounts`, {
        headers: { "bypass-tunnel-reminder": "true" }
      });
      return res.json();
    } catch { return { accounts: [] }; }
  },

  getDialogs: async (phone: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/dialogs/${encodeURIComponent(phone)}`, {
        headers: { "bypass-tunnel-reminder": "true" }
      });
      return res.json();
    } catch { return { dialogs: [] }; }
  },

  getMessages: async (phone: string, username: string) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/messages/${encodeURIComponent(phone)}/${encodeURIComponent(username)}`,
        { headers: { "bypass-tunnel-reminder": "true" } }
      );
      return res.json();
    } catch { return { messages: [] }; }
  },

  sendMessage: async (phone: string, username: string, text: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
        body: JSON.stringify({ phone, username, text })
      });
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  getProfile: async (phone: string, username: string) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/profile/${encodeURIComponent(phone)}/${encodeURIComponent(username)}`,
        { headers: { "bypass-tunnel-reminder": "true" } }
      );
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  updateApiKeys: async (apiId: string, apiHash: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "bypass-tunnel-reminder": "true" },
        body: JSON.stringify({ api_id: apiId, api_hash: apiHash })
      });
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  sendMedia: async (phone: string, username: string, file: File, caption = "") => {
    try {
      const form = new FormData();
      form.append("phone", phone);
      form.append("username", username);
      form.append("caption", caption);
      form.append("file", file);
      const res = await fetch(`${BACKEND_URL}/api/send-media`, {
        method: "POST",
        headers: { "bypass-tunnel-reminder": "true" },
        body: form,
      });
      return res.json();
    } catch { return { error: "Backend недоступен" }; }
  },

  connectWebSocket: (onMessage: (data: any) => void): WebSocket | null => {
    try {
      const wsUrl = BACKEND_URL.replace("https://", "wss://").replace("http://", "ws://");
      const ws = new WebSocket(`${wsUrl}/ws`);
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type !== "ping") onMessage(data);
        } catch { /* ignore */ }
      };
      ws.onerror = () => console.log("WebSocket недоступен — демо-режим");
      return ws;
    } catch { return null; }
  }
};
