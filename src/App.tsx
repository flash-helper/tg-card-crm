
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard, MessageSquare, BarChart3, Wallet, CheckSquare, Settings,
  ChevronLeft, ChevronRight, Bell, Sun, Moon, LogOut, Plus, Search,
  Filter, X, Check, Edit2, Trash2, Send, Paperclip, Phone, User,
  ExternalLink, Archive, VolumeX, Volume2, ChevronDown, GripVertical,
  RefreshCw, Zap, TrendingUp, Users, Clock, DollarSign, Activity,
  MessageCircle, MoreVertical, Star, Hash, Calendar, MapPin, Link,
  ToggleLeft, ToggleRight, Eye, EyeOff, Copy, AlertCircle, Inbox,
  FolderOpen, Tag, Shield, Lock, Unlock, UserPlus, Image, Video,
  FileText, Smile, RussianRuble
} from "lucide-react";
import {
  ALL_STATUSES, STATUS_CONFIG, initTgAccounts, initPartnerNetworks,
  initOffers, initCabinets, initLeads, initTasks, initBalanceHistory,
  initQuickReplies, initChatMessages, initUsers, DEFAULT_ADMIN_HASH,
  type LeadStatus, type TgAccount, type PartnerNetwork, type Offer,
  type LkCabinet, type Lead, type ChatMessage, type Task,
  type BalanceRecord, type QuickReply, type Notification, type CrmUser, type ChatFolder,
} from "./data";
import { api, BACKEND_URL } from "./config";

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function sha256(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function ls<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function avatarText(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}
function avatarColor(id: number) {
  const colors = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6","#f97316","#06b6d4"];
  return colors[Math.abs(id) % colors.length];
}
function fmtDate(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "только что";
  if (diff < 3600000) return `${Math.floor(diff/60000)} мин`;
  if (diff < 86400000) return fmtTime(iso);
  if (diff < 172800000) return "вчера";
  return fmtDate(iso);
}
function countdown(iso: string): { text: string; overdue: boolean } {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return { text: "Просрочено", overdue: true };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { text: `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`, overdue: false };
}
function normPhone(p: string) { return p.replace(/\D/g, ""); }

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = "tg_crm_db3";
const DB_VER = 1;
const MSG_STORE = "messages";
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MSG_STORE)) {
        const store = db.createObjectStore(MSG_STORE, { keyPath: "id" });
        store.createIndex("lead_id", "lead_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetMessages(leadId: number): Promise<ChatMessage[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MSG_STORE, "readonly");
      const idx = tx.objectStore(MSG_STORE).index("lead_id");
      const req = idx.getAll(leadId);
      req.onsuccess = () => resolve((req.result||[]).sort((a,b)=>new Date(a.sent_at).getTime()-new Date(b.sent_at).getTime()));
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}
async function idbPutMessages(msgs: ChatMessage[]): Promise<void> {
  if (!msgs.length) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MSG_STORE, "readwrite");
      const store = tx.objectStore(MSG_STORE);
      msgs.forEach(m => store.put(m));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { }
}
async function idbPutMessage(msg: ChatMessage): Promise<void> { await idbPutMessages([msg]); }
async function idbGetLastMsgPerLead(): Promise<Record<number, ChatMessage>> {
  try {
    const db = await openDB();
    const all: ChatMessage[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(MSG_STORE, "readonly");
      const req = tx.objectStore(MSG_STORE).getAll();
      req.onsuccess = () => resolve(req.result||[]);
      req.onerror = () => reject(req.error);
    });
    const map: Record<number, ChatMessage> = {};
    for (const m of all) {
      const prev = map[m.lead_id];
      if (!prev || new Date(m.sent_at) > new Date(prev.sent_at)) map[m.lead_id] = m;
    }
    return map;
  } catch { return {}; }
}

// ─── UI Components ────────────────────────────────────────────────────────────

// Status Badge
function StatusBadge({ status, size = "sm" }: { status: LeadStatus; size?: "xs"|"sm"|"md" }) {
  const cfg = STATUS_CONFIG[status];
  const sizes = { xs: "text-[10px] px-1.5 py-0.5", sm: "text-xs px-2 py-1", md: "text-sm px-3 py-1.5" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${sizes[size]}`}
      style={{ background: cfg.bg + "22", color: cfg.color, border: `1px solid ${cfg.dot}33` }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.dot, flexShrink: 0, display: "inline-block" }} />
      {cfg.label}
    </span>
  );
}

// Avatar
function Avatar({ url, name, id, size = 36 }: { url?: string; name: string; id: number; size?: number }) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    return <img src={url} onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} alt={name} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: avatarColor(id), display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: size * 0.36, fontWeight: 700, flexShrink: 0, letterSpacing: "-0.5px" }}>
      {avatarText(name)}
    </div>
  );
}

// Btn
function Btn({ children, onClick, variant = "primary", size = "md", className = "", disabled = false, type = "button" }:
  { children: React.ReactNode; onClick?: () => void; variant?: "primary"|"secondary"|"ghost"|"danger"|"success"; size?: "sm"|"md"|"lg"; className?: string; disabled?: boolean; type?: "button"|"submit" }) {
  const variants = {
    primary: "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30",
    secondary: "bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-main)] border border-[var(--border)]",
    ghost: "hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-main)]",
    danger: "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20",
    success: "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20",
  };
  const sizes = { sm: "px-3 py-1.5 text-xs rounded-lg", md: "px-4 py-2 text-sm rounded-xl", lg: "px-6 py-3 text-sm rounded-xl" };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </button>
  );
}

// Card
function Card({ children, className = "", onClick, hover = false, style }: { children: React.ReactNode; className?: string; onClick?: () => void; hover?: boolean; style?: React.CSSProperties }) {
  return (
    <div onClick={onClick} style={style}
      className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl ${hover ? "card-hover cursor-pointer" : ""} ${onClick && !hover ? "cursor-pointer" : ""} ${className}`}>
      {children}
    </div>
  );
}

// Input
function Input({ value, onChange, placeholder, type = "text", className = "", onKeyDown, rows, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
  className?: string; onKeyDown?: (e: React.KeyboardEvent) => void; rows?: number; disabled?: boolean;
}) {
  const cls = `input-base ${className}`;
  if (rows) return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows} className={cls} style={{ resize: "none" }} />;
  return <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} className={cls} onKeyDown={onKeyDown} disabled={disabled} />;
}

// Select
function Select({ value, onChange, children, className = "" }: { value: string|number; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`input-base cursor-pointer ${className}`} style={{ appearance: "none" }}>
      {children}
    </select>
  );
}

// Modal
function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-t-3xl md:rounded-2xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto animate-slideUp shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
          <h2 className="font-semibold text-[var(--text-main)] text-base">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-main)] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}

// Toast
function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-3 pl-4 pr-2 py-2.5 rounded-2xl shadow-2xl animate-slideUp text-sm font-medium"
      style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)", color: "#fff", boxShadow: "0 8px 32px rgba(99,102,241,0.4)" }}>
      <span>{text}</span>
      <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white/20 transition-colors">
        <X size={14} />
      </button>
    </div>
  );
}

// StatusDropdown via portal
function StatusDropdown({ current, onChange, onClose, anchorEl }: {
  current: LeadStatus; onChange: (s: LeadStatus) => void; onClose: () => void; anchorEl: HTMLElement;
}) {
  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 4 + window.scrollY;
  let left = rect.left + window.scrollX;
  if (left + 192 > window.innerWidth) left = window.innerWidth - 200;
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-status-dd]")) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return createPortal(
    <div data-status-dd style={{ position: "absolute", top, left, zIndex: 9999 }}
      className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl py-2 w-48 animate-scaleIn">
      {ALL_STATUSES.map(s => {
        const cfg = STATUS_CONFIG[s];
        return (
          <button key={s} onMouseDown={e => { e.preventDefault(); onChange(s); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--bg-elevated)] transition-colors ${s === current ? "font-semibold" : ""}`}>
            <span style={{ background: cfg.dot, width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
            <span style={{ color: cfg.color }} className="flex-1 text-left">{cfg.label}</span>
            {s === current && <Check size={13} className="text-indigo-400 ml-auto" />}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

// ─── Lead Modal (отдельный компонент чтобы не терять фокус при вводе) ────────
interface LeadModalProps {
  lead: Lead;
  isNew: boolean;
  offers: Offer[];
  cabinets: LkCabinet[];
  partnerNetworks: PartnerNetwork[];
  realTgAccounts: { phone: string; label: string; name: string }[];
  isAdmin: boolean;
  onSave: (lead: Lead) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}
const LeadModalForm = React.memo(function LeadModalForm({
  lead: initialLead, isNew, offers, cabinets, partnerNetworks, realTgAccounts, isAdmin, onSave, onDelete, onClose
}: LeadModalProps) {
  const [lead, setLead] = useState<Lead>(() => ({...initialLead}));
  const idRef = useRef(initialLead.id);

  // Сбрасываем state ТОЛЬКО когда открывается другой лид (другой id)
  useEffect(() => {
    if (initialLead.id !== idRef.current) {
      idRef.current = initialLead.id;
      setLead({...initialLead});
    }
  }, [initialLead.id]); // зависимость только от id, не от всего объекта!

  const set = useCallback(<K extends keyof Lead>(field: K, value: Lead[K]) => {
    setLead(prev => ({...prev, [field]: value}));
  }, []);

  const selectedOffer = offers.find(o => o.id === lead.offer_id);
  const offerCabinets = cabinets.filter(c => c.offer_id === lead.offer_id && !c.is_archived);
  const pn = selectedOffer?.type === "partner" ? partnerNetworks.find(p => p.id === selectedOffer.partner_network_id) : null;

  const F = useCallback(({ label, children }: { label: string; children: React.ReactNode }) => (
    <div><label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">{label}</label>{children}</div>
  ), []);

  return (
    <Modal title={isNew ? "Новый лид" : "Редактировать лид"} onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <F label="Имя"><input className="input-base" value={lead.full_name} onChange={e => set("full_name", e.target.value)} placeholder="Имя фамилия" /></F>
        <F label="TG Username"><input className="input-base" value={lead.tg_username} onChange={e => set("tg_username", e.target.value)} placeholder="@username" /></F>
        <F label="TG User ID"><input className="input-base" value={lead.tg_user_id} onChange={e => set("tg_user_id", e.target.value)} placeholder="123456789" /></F>
        <F label="Телефон"><input className="input-base" value={lead.phone} onChange={e => set("phone", e.target.value)} placeholder="+79001234567" /></F>
        <F label="Источник"><input className="input-base" value={lead.source} onChange={e => set("source", e.target.value)} placeholder="tiktok / vk / instagram" /></F>
        <F label="TG Аккаунт (для ответов)">
          <select className="input-base cursor-pointer" style={{appearance:"none"}} value={lead.tg_account_phone} onChange={e => set("tg_account_phone", e.target.value)}>
            <option value="">— не выбран —</option>
            {realTgAccounts.map(a => <option key={a.phone} value={a.phone}>{a.label} ({a.phone})</option>)}
          </select>
        </F>
        <F label="Статус">
          <select className="input-base cursor-pointer" style={{appearance:"none"}} value={lead.status} onChange={e => set("status", e.target.value as LeadStatus)}>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
          </select>
        </F>
        <F label="Оффер">
          <select className="input-base cursor-pointer" style={{appearance:"none"}} value={lead.offer_id} onChange={e => { set("offer_id", +e.target.value); set("cabinet_id", null); }}>
            <option value={0}>— не выбран —</option>
            {offers.map(o => <option key={o.id} value={o.id}>{o.name} ({o.reward_amount}₽)</option>)}
          </select>
        </F>
        {selectedOffer?.type === "partner" && pn && (
          <F label="Партнёрская сеть">
            <div className="input-base bg-[var(--bg-main)] text-[var(--text-secondary)]">
              {isAdmin ? pn.name : "🔒 скрыто"}
            </div>
          </F>
        )}
        {selectedOffer?.type === "lk" && (
          <F label="ЛК Кабинет">
            <select className="input-base cursor-pointer" style={{appearance:"none"}} value={lead.cabinet_id || ""} onChange={e => set("cabinet_id", e.target.value ? +e.target.value : null)}>
              <option value="">— не выбран —</option>
              {offerCabinets.map(c => <option key={c.id} value={c.id}>{c.name} ({c.leads_count}/{c.max_leads})</option>)}
            </select>
          </F>
        )}
        <F label="Дата доставки"><input className="input-base" type="date" value={lead.delivery_date} onChange={e => set("delivery_date", e.target.value)} /></F>
        <F label="Адрес доставки"><input className="input-base" value={lead.delivery_address} onChange={e => set("delivery_address", e.target.value)} placeholder="Город, улица, дом" /></F>
        <F label="Заметки"><textarea className="input-base" value={lead.notes} onChange={e => set("notes", e.target.value)} placeholder="Заметки..." rows={2} style={{resize:"none"}} /></F>
      </div>
      <div className="flex gap-3 mt-6 pt-4 border-t border-[var(--border)]">
        <Btn onClick={() => onSave(lead)} className="flex-1 justify-center"><Check size={15} /> Сохранить</Btn>
        {!isNew && <Btn variant="danger" onClick={() => onDelete(lead.id)}><Trash2 size={14} /> Удалить</Btn>}
        <Btn variant="secondary" onClick={onClose}>Отмена</Btn>
      </div>
    </Modal>
  );
});

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (u: CrmUser) => void }) {
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async () => {
    setLoading(true); setErr("");
    const users: CrmUser[] = ls("crm_users", initUsers);
    const hash = await sha256(pass);
    const user = users.find(u => u.name === name && u.password_hash === hash);
    if (!user) { setErr("Неверный логин или пароль"); setLoading(false); return; }
    if (user.is_blocked) { setErr("Аккаунт заблокирован"); setLoading(false); return; }
    localStorage.setItem("crm_session", JSON.stringify(user));
    onLogin(user);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg-main)" }}>
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full" style={{ background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)" }} />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full" style={{ background: "radial-gradient(circle, rgba(124,58,237,0.06) 0%, transparent 70%)" }} />
      </div>

      <div className="relative w-full max-w-sm animate-fadeUp">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 8px 32px rgba(99,102,241,0.4)" }}>
            <span className="text-2xl">💳</span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">TG Card CRM</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Войдите в систему</p>
        </div>

        <Card className="p-8">
          {err && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-sm mb-5">
              <AlertCircle size={15} />
              {err}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Логин</label>
              <Input value={name} onChange={setName} placeholder="Введите логин" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Пароль</label>
              <div className="relative">
                <Input value={pass} onChange={setPass} type={showPass ? "text" : "password"} placeholder="••••••••"
                  onKeyDown={e => e.key === "Enter" && submit()} />
                <button onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-main)]">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <Btn onClick={submit} disabled={loading} size="lg" className="w-full justify-center">
              {loading ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />Входим...</> : "Войти →"}
            </Btn>
          </div>
          <p className="text-center text-xs text-[var(--text-secondary)] mt-5 p-3 rounded-xl" style={{ background: "var(--bg-elevated)" }}>
            admin / admin123
          </p>
        </Card>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({ currentUser, onLogout }: { currentUser: CrmUser; onLogout: () => void }) {
  const isAdmin = currentUser.role === "admin";

  // ── UI ──
  const [dark, setDark] = useState(() => ls("crm_dark", true));
  const [sidebarOpen, setSidebarOpen] = useState(() => ls("crm_sidebar", true));
  const [page, setPage] = useState<"leads"|"chat"|"balance"|"tasks"|"stats"|"settings">("leads");
  const [toast, setToast] = useState<string|null>(null);

  // ── Data ──
  const [leads, setLeads] = useState<Lead[]>(() => ls("crm_leads", initLeads));
  const [accounts] = useState<TgAccount[]>(() => ls("crm_accounts", initTgAccounts));
  const [partnerNetworks, setPartnerNetworks] = useState<PartnerNetwork[]>(() => ls("crm_partners", initPartnerNetworks));
  const [offers, setOffers] = useState<Offer[]>(() => ls("crm_offers", initOffers));
  const [cabinets, setCabinets] = useState<LkCabinet[]>(() => ls("crm_cabinets", initCabinets));
  const [tasks, setTasks] = useState<Task[]>(() => ls("crm_tasks", initTasks));
  const [balanceHistory, setBalanceHistory] = useState<BalanceRecord[]>(() => ls("crm_balance", initBalanceHistory));
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(() => ls("crm_replies", initQuickReplies));
  const [notifications, setNotifications] = useState<Notification[]>(() => ls("crm_notifs", []));
  const [users, setUsers] = useState<CrmUser[]>(() => ls("crm_users", initUsers));
  const [chatFolders, setChatFolders] = useState<ChatFolder[]>(() => ls("crm_folders", []));
  const [chatLastSeen, setChatLastSeen] = useState<Record<number, string>>(() => ls("crm_lastseen", {}));
  const [mutedLeads, setMutedLeads] = useState<number[]>(() => ls("crm_muted", []));
  const [archivedChats, setArchivedChats] = useState<number[]>(() => ls("crm_archived_chats", []));
  const [disabledTgPhones, setDisabledTgPhones] = useState<string[]>(() => ls("crm_disabled_tg", []));

  // ── IDB ──
  const [lastMsgMap, setLastMsgMap] = useState<Record<number, ChatMessage>>({});
  const [unreadMap, setUnreadMap] = useState<Record<number, number>>({});
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);

  // ── TG ──
  const [realTgAccounts, setRealTgAccounts] = useState<{phone:string;label:string;name:string;username:string}[]>([]);
  const [avatarCache, setAvatarCache] = useState<Record<string, string>>(() => {
    try {
      const cached = localStorage.getItem("crm_avatars");
      return cached ? JSON.parse(cached) : {};
    } catch { return {}; }
  });
  const [sendFromPhone, setSendFromPhone] = useState<string>("");
  const [chatAccountFilter, setChatAccountFilter] = useState<string>("all");

  // ── Notifications ──
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifShowAll, setNotifShowAll] = useState(false);
  const unreadNotifs = notifications.filter(n => !n.is_read).length;

  // ── Leads ──
  const [leadsTab, setLeadsTab] = useState<"leads"|"people">("leads");
  const [leadsView, setLeadsView] = useState<"table"|"cards">("table");
  const [leadsSearch, setLeadsSearch] = useState("");
  const [leadsFilterStatus, setLeadsFilterStatus] = useState<LeadStatus|"">("");
  const [leadsFilterAccount, setLeadsFilterAccount] = useState<number|"">("");
  const [leadsFilterOffer, setLeadsFilterOffer] = useState<number|"">("");
  const [leadsSort, setLeadsSort] = useState<"delivery"|"created"|"status"|"name"|"lastmsg">("created");
  const [leadsSortDir, setLeadsSortDir] = useState<"asc"|"desc">("desc");
  const [leadsShowFilter, setLeadsShowFilter] = useState(false);
  const [leadModal, setLeadModal] = useState<Lead|null>(null);
  const [leadModalNew, setLeadModalNew] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState<{lead:Lead;el:HTMLElement}|null>(null);

  // ── Chat ──
  const [chatSelectedLeadId, setChatSelectedLeadId] = useState<number|null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [chatFilterStatuses, setChatFilterStatuses] = useState<LeadStatus[]>([]);
  const [chatVisibleCount, setChatVisibleCount] = useState(50); // Виртуализация — показываем первые N диалогов
  const [chatFilterDateFrom, setChatFilterDateFrom] = useState("");
  const [chatFilterDateTo, setChatFilterDateTo] = useState("");
  const [chatShowFilter, setChatShowFilter] = useState(false);
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [chatActiveFolderId, setChatActiveFolderId] = useState<number|null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatProfileOpen, setChatProfileOpen] = useState(false);
  const [chatProfileEditing, setChatProfileEditing] = useState(false);
  const [chatProfileDraft, setChatProfileDraft] = useState<Partial<Lead>>({});
  const [chatMobileShowList, setChatMobileShowList] = useState(true);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [chatEditDelivery, setChatEditDelivery] = useState(false);
  const [chatDeliveryInput, setChatDeliveryInput] = useState("");
  const [chatContextMenu, setChatContextMenu] = useState<{leadId:number;x:number;y:number}|null>(null);
  const [chatMediaFile, setChatMediaFile] = useState<File|null>(null);
  const [chatMediaPreview, setChatMediaPreview] = useState<string>("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const [chatSending, setChatSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [tgQuickReplies, setTgQuickReplies] = useState<{shortcut:string;text:string}[]>([]);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogProgress, setDialogProgress] = useState({ loaded: 0, total: 0 });

  // ── Balance ──
  const [balanceFilterAccount, setBalanceFilterAccount] = useState<number|"">("");
  const [balanceFilterType, setBalanceFilterType] = useState<""|"hold"|"earned"|"withdrawal">("");
  const [balancePeriod, setBalancePeriod] = useState<"all"|"today"|"week"|"month">("all");

  // ── Tasks ──
  const [now, setNow] = useState(Date.now());
  const [taskModal, setTaskModal] = useState(false);
  const [taskDraft, setTaskDraft] = useState<Partial<Task>>({});
  const [editTaskId, setEditTaskId] = useState<number|null>(null);
  const [taskLeadSearch, setTaskLeadSearch] = useState("");

  // ── Stats ──
  const [statsRange, setStatsRange] = useState<"today"|"yesterday"|"week"|"month"|"all">("week");
  const [statsAccount, setStatsAccount] = useState<string>("all");
  const [statsDateFrom, setStatsDateFrom] = useState("");
  const [statsDateTo, setStatsDateTo] = useState("");
  const [statsTooltip, setStatsTooltip] = useState<{x:number;y:number;data:Record<string,unknown>}|null>(null);

  // ── Settings ──
  const [settingsTab, setSettingsTab] = useState<"offers"|"accounts"|"partners"|"team"|"replies">("accounts");
  const [dragIdx, setDragIdx] = useState<number|null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number|null>(null);
  const [apiIdInput, setApiIdInput] = useState(() => ls("crm_api_id", ""));
  const [apiHashInput, setApiHashInput] = useState(() => ls("crm_api_hash", ""));
  const [tgStep, setTgStep] = useState<0|1|2>(0);
  const [tgPhone, setTgPhone] = useState("");
  const [tgLabel, setTgLabel] = useState("");
  const [tgCode, setTgCode] = useState("");
  const [tgPassword, setTgPassword] = useState("");
  const [tgLoading, setTgLoading] = useState(false);
  const [tgError, setTgError] = useState("");
  const [newCabinetOfferId, setNewCabinetOfferId] = useState<number|"">("") ;
  const [newCabinetName, setNewCabinetName] = useState("");
  const [newCabinetLink, setNewCabinetLink] = useState("");
  const [newCabinetMax, setNewCabinetMax] = useState("33");
  const [showArchivedCab, setShowArchivedCab] = useState(false);
  const [newManagerName, setNewManagerName] = useState("");
  const [newManagerPass, setNewManagerPass] = useState("");
  const [showNewManager, setShowNewManager] = useState(false);
  const [editReplyId, setEditReplyId] = useState<number|null>(null);
  const [editReplyDraft, setEditReplyDraft] = useState<{shortcut:string;text:string}>({shortcut:"",text:""});
  const [newReplyShortcut, setNewReplyShortcut] = useState("");
  const [newReplyText, setNewReplyText] = useState("");
  const [newOfferName, setNewOfferName] = useState("");
  const [newOfferType, setNewOfferType] = useState<"lk"|"partner">("lk");
  const [newOfferPartner, setNewOfferPartner] = useState<number|"">("") ;
  const [newOfferAmount, setNewOfferAmount] = useState("1500");
  const [showNewOffer, setShowNewOffer] = useState(false);
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerUrl, setNewPartnerUrl] = useState("");
  const [newPartnerNotes, setNewPartnerNotes] = useState("");
  const [showNewPartner, setShowNewPartner] = useState(false);

  // ── Effects ──
  useEffect(() => {
    const html = document.documentElement;
    if (dark) { html.classList.add("dark"); html.classList.remove("light"); }
    else { html.classList.add("light"); html.classList.remove("dark"); }
    localStorage.setItem("crm_dark", JSON.stringify(dark));
  }, [dark]);

  useEffect(() => { localStorage.setItem("crm_leads", JSON.stringify(leads)); }, [leads]);
  useEffect(() => { localStorage.setItem("crm_offers", JSON.stringify(offers)); }, [offers]);
  useEffect(() => { localStorage.setItem("crm_cabinets", JSON.stringify(cabinets)); }, [cabinets]);
  useEffect(() => { localStorage.setItem("crm_tasks", JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem("crm_balance", JSON.stringify(balanceHistory)); }, [balanceHistory]);
  useEffect(() => { localStorage.setItem("crm_replies", JSON.stringify(quickReplies)); }, [quickReplies]);
  useEffect(() => { localStorage.setItem("crm_notifs", JSON.stringify(notifications)); }, [notifications]);
  useEffect(() => { localStorage.setItem("crm_users", JSON.stringify(users)); }, [users]);
  useEffect(() => { localStorage.setItem("crm_folders", JSON.stringify(chatFolders)); }, [chatFolders]);
  useEffect(() => { localStorage.setItem("crm_lastseen", JSON.stringify(chatLastSeen)); }, [chatLastSeen]);
  useEffect(() => { localStorage.setItem("crm_muted", JSON.stringify(mutedLeads)); }, [mutedLeads]);
  // Сохраняем avatarCache с ограничением 200 записей
  useEffect(() => {
    try {
      const entries = Object.entries(avatarCache);
      const limited = Object.fromEntries(entries.slice(-200));
      localStorage.setItem("crm_avatars", JSON.stringify(limited));
    } catch { }
  }, [avatarCache]);
  useEffect(() => { localStorage.setItem("crm_archived_chats", JSON.stringify(archivedChats)); }, [archivedChats]);
  useEffect(() => { localStorage.setItem("crm_disabled_tg", JSON.stringify(disabledTgPhones)); }, [disabledTgPhones]);
  useEffect(() => { localStorage.setItem("crm_sidebar", JSON.stringify(sidebarOpen)); }, [sidebarOpen]);
  useEffect(() => { localStorage.setItem("crm_partners", JSON.stringify(partnerNetworks)); }, [partnerNetworks]);

  // Timer
  useEffect(() => {
    if (page !== "tasks") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [page]);

  // IDB init
  useEffect(() => {
    idbGetLastMsgPerLead().then(map => {
      setLastMsgMap(map);
      const uMap: Record<number, number> = {};
      leads.forEach(l => {
        const last = map[l.id];
        if (!last || last.direction !== "incoming") return;
        const seen = chatLastSeen[l.id];
        if (!seen || new Date(last.sent_at) > new Date(seen)) uMap[l.id] = (uMap[l.id]||0) + 1;
      });
      setUnreadMap(uMap);
    });
  }, []);

  // WS
  useEffect(() => {
    const ws = api.connectWebSocket((data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d.type !== "new_message") return;
      const username = String(d.username || "");
      const tgUserId = String(d.tg_user_id || "");
      const lead = leads.find(l =>
        (username && (l.tg_username === username || l.tg_username === username.replace("@",""))) ||
        (tgUserId && l.tg_user_id === tgUserId)
      );
      if (!lead) return;
      const msg: ChatMessage = {
        id: Date.now() + Math.random(),
        lead_id: lead.id,
        tg_account_id: lead.tg_account_id,
        direction: d.direction as "incoming"|"outgoing",
        text: String(d.text || ""),
        sent_at: String(d.sent_at || new Date().toISOString()),
        media_url: d.media_url as string || "",
        media_type: d.media_type as "photo"|"video"|"document"|"" || "",
      };
      idbPutMessage(msg).then(() => {
        setLastMsgMap(prev => {
          const cur = prev[lead.id];
          if (!cur || new Date(msg.sent_at) > new Date(cur.sent_at)) return { ...prev, [lead.id]: msg };
          return prev;
        });
        if (chatSelectedLeadId === lead.id) {
          setActiveMessages(prev => {
            if (prev.find(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
          const seen = new Date().toISOString();
          setChatLastSeen(p => ({ ...p, [lead.id]: seen }));
          localStorage.setItem("crm_lastseen", JSON.stringify({ ...chatLastSeen, [lead.id]: seen }));
        } else if (!mutedLeads.includes(lead.id)) {
          const n: Notification = {
            id: Date.now(), text: `💬 ${lead.full_name || lead.tg_username}: ${msg.text.slice(0,60)}`,
            is_read: false, created_at: new Date().toISOString(), type: "message", lead_id: lead.id
          };
          setNotifications(prev => [n, ...prev].slice(0, 100));
          setUnreadMap(prev => ({ ...prev, [lead.id]: (prev[lead.id]||0) + 1 }));
        }
      });
    });
    return () => { ws?.close(); };
  }, [leads, chatSelectedLeadId, mutedLeads]);

  // Delivery notifications
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tStr = tomorrow.toISOString().split("T")[0];
    leads.filter(l => l.delivery_date === tStr).forEach(l => {
      const exists = notifications.some(n => n.lead_id === l.id && n.type === "delivery" && n.created_at.startsWith(new Date().toISOString().split("T")[0]));
      if (!exists) {
        const n: Notification = {
          id: Date.now() + l.id, text: `📦 Доставка завтра: ${l.full_name}`,
          is_read: false, created_at: new Date().toISOString(), type: "delivery", lead_id: l.id
        };
        setNotifications(prev => [n, ...prev]);
      }
    });
  }, [leads]);

  // Load real TG accounts — при старте и повтор через 3 сек если пусто
  useEffect(() => {
    const load = () => api.getAccounts().then(r => {
      if (r.accounts?.length) setRealTgAccounts(r.accounts);
    }).catch(() => {});
    load();
    const t1 = setTimeout(load, 3000);
    const t2 = setTimeout(load, 8000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  // ── Helpers ──
  const showToast = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ── handleStatusChange — обновляет статус и баланс ────────────────────────
  const handleStatusChange = useCallback((lead: Lead, newStatus: LeadStatus) => {
    const offer = offers.find(o => o.id === lead.offer_id);
    const reward = offer?.reward_amount || 0;
    const now = new Date().toISOString();
    const accId = lead.tg_account_id || 0;

    const holdStatuses: LeadStatus[] = ["самовывоз","доставка","сделано","сделать_цд","холд"];
    const wasHold = holdStatuses.includes(lead.status);
    const wasEarned = lead.status === "оплачено";
    const willHold = holdStatuses.includes(newStatus);
    const willEarned = newStatus === "оплачено";
    const willCancel = newStatus === "отказ" || newStatus === "новый";

    const newRecords: BalanceRecord[] = [];

    // Сторнируем предыдущий статус
    if (wasHold && reward > 0 && !willHold) {
      newRecords.push({ id: Date.now()+1, tg_account_id: accId, amount: -reward, type: "hold", offer_id: lead.offer_id||null, lead_id: lead.id, description: `Сторно холда — ${lead.full_name} — ${offer?.name||""}`, created_at: now });
    }
    if (wasEarned && reward > 0 && !willEarned) {
      newRecords.push({ id: Date.now()+2, tg_account_id: accId, amount: -reward, type: "earned", offer_id: lead.offer_id||null, lead_id: lead.id, description: `Сторно оплаты — ${lead.full_name} — ${offer?.name||""}`, created_at: now });
    }

    // Начисляем новый статус
    if (willHold && !wasHold && reward > 0) {
      newRecords.push({ id: Date.now()+3, tg_account_id: accId, amount: reward, type: "hold", offer_id: lead.offer_id||null, lead_id: lead.id, description: `Холд — ${lead.full_name} — ${offer?.name||""}`, created_at: now });
    }
    if (willEarned && reward > 0) {
      // Сторно холда + начисление оплачено
      if (wasHold) {
        newRecords.push({ id: Date.now()+4, tg_account_id: accId, amount: -reward, type: "hold", offer_id: lead.offer_id||null, lead_id: lead.id, description: `Сторно холда → оплачено — ${lead.full_name}`, created_at: now });
      }
      newRecords.push({ id: Date.now()+5, tg_account_id: accId, amount: reward, type: "earned", offer_id: lead.offer_id||null, lead_id: lead.id, description: `Оплачено — ${lead.full_name} — ${offer?.name||""}`, created_at: now });
    }

    if (newRecords.length > 0) {
      setBalanceHistory(prev => [...prev, ...newRecords]);
    }

    // Обновляем лида
    const updatedLead: Lead = {
      ...lead,
      status: newStatus,
      updated_at: now,
      is_paid: willEarned,
      paid_date: willEarned ? now.split("T")[0] : lead.paid_date,
      reward_paid: willEarned ? reward : lead.reward_paid,
    };
    setLeads(prev => prev.map(l => l.id === lead.id ? updatedLead : l));
    showToast(`✅ Статус → ${STATUS_CONFIG[newStatus].label}${reward > 0 && (willHold||willEarned) ? ` · ${reward.toLocaleString()}₽` : ""}`);
  }, [offers, setLeads, setBalanceHistory, showToast]);

  const unreadCount = useMemo(() => {
    return leads.filter(l => !mutedLeads.includes(l.id) && unreadMap[l.id] > 0).length;
  }, [leads, mutedLeads, unreadMap]);

  const getPhoneForLead = useCallback((lead: Lead): string => {
    if (lead.tg_account_phone) return lead.tg_account_phone;
    const real = realTgAccounts[0];
    return real?.phone || "";
  }, [realTgAccounts]);

  const openChat = useCallback((leadId: number) => {
    setChatSelectedLeadId(leadId);
    setChatMobileShowList(false);
    setChatProfileOpen(false);
    const seen = new Date().toISOString();
    setChatLastSeen(p => ({ ...p, [leadId]: seen }));
    localStorage.setItem("crm_lastseen", JSON.stringify({ ...chatLastSeen, [leadId]: seen }));
    setUnreadMap(p => ({ ...p, [leadId]: 0 }));
    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      // Автоматически выбираем аккаунт лида для отправки
      const leadPhone = lead.tg_account_phone || realTgAccounts[0]?.phone || "";
      setSendFromPhone(leadPhone);
      const phone = lead.tg_account_phone || realTgAccounts[0]?.phone || "";
      setSendFromPhone(phone);
      if (lead.tg_username && phone) {
        api.getProfile(phone, lead.tg_username || lead.tg_user_id).then(p => {
          if (p.avatar_url) setAvatarCache(prev => ({ ...prev, [lead.tg_username]: p.avatar_url }));
        }).catch(() => {});
      }
    }
    idbGetMessages(leadId).then(msgs => setActiveMessages(msgs));
  }, [leads, realTgAccounts, chatLastSeen]);

  const markNotifRead = (id: number) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  const removeNotif = (id: number) => setNotifications(prev => prev.filter(n => n.id !== id));
  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));

  const toggleMute = (id: number) => setMutedLeads(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleArchive = (id: number, archive: boolean) => {
    setArchivedChats(prev => archive ? [...prev, id] : prev.filter(x => x !== id));
  };

  const handleSort = (field: "delivery"|"created"|"status"|"name"|"lastmsg") => {
    if (leadsSort === field) setLeadsSortDir(d => d === "asc" ? "desc" : "asc");
    else { setLeadsSort(field); setLeadsSortDir("asc"); }
  };

  // ── Filtered leads ──
  const visibleAccounts = useMemo(() => {
    if (!isAdmin) return accounts.filter(a => currentUser.account_ids.includes(a.id));
    return accounts;
  }, [accounts, isAdmin, currentUser]);

  const filteredLeads = useMemo(() => {
    let arr = [...leads];
    if (!isAdmin) arr = arr.filter(l => currentUser.account_ids.includes(l.tg_account_id));
    const q = leadsSearch.toLowerCase().replace("@","");
    if (q) arr = arr.filter(l =>
      l.full_name.toLowerCase().includes(q) ||
      l.tg_username.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.tg_user_id.includes(q)
    );
    if (leadsFilterStatus) arr = arr.filter(l => l.status === leadsFilterStatus);
    if (leadsFilterAccount) arr = arr.filter(l => l.tg_account_id === leadsFilterAccount);
    if (leadsFilterOffer) arr = arr.filter(l => l.offer_id === leadsFilterOffer);
    arr.sort((a, b) => {
      let res = 0;
      if (leadsSort === "delivery") {
        if (!a.delivery_date && !b.delivery_date) res = 0;
        else if (!a.delivery_date) res = 1;
        else if (!b.delivery_date) res = -1;
        else res = new Date(a.delivery_date).getTime() - new Date(b.delivery_date).getTime();
      } else if (leadsSort === "created") {
        res = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (leadsSort === "status") {
        res = ALL_STATUSES.indexOf(a.status) - ALL_STATUSES.indexOf(b.status);
      } else if (leadsSort === "name") {
        res = a.full_name.localeCompare(b.full_name, "ru");
      } else if (leadsSort === "lastmsg") {
        const ma = lastMsgMap[a.id]?.sent_at || a.created_at;
        const mb = lastMsgMap[b.id]?.sent_at || b.created_at;
        res = new Date(ma).getTime() - new Date(mb).getTime();
      }
      return leadsSortDir === "asc" ? res : -res;
    });
    return arr;
  }, [leads, leadsSearch, leadsFilterStatus, leadsFilterAccount, leadsFilterOffer, leadsSort, leadsSortDir, isAdmin, currentUser, lastMsgMap]);

  // ── Chat leads ──
  const chatLeads = useMemo(() => {
    let arr = [...leads];
    if (!isAdmin) arr = arr.filter(l => currentUser.account_ids.includes(l.tg_account_id));
    if (!showArchivedChats) arr = arr.filter(l => !archivedChats.includes(l.id));
    else arr = arr.filter(l => archivedChats.includes(l.id));
    arr = arr.filter(l => !disabledTgPhones.includes(l.tg_account_phone));
    if (chatAccountFilter !== "all") arr = arr.filter(l => l.tg_account_phone === chatAccountFilter);
    if (chatActiveFolderId !== null) {
      const folder = chatFolders.find(f => f.id === chatActiveFolderId);
      if (folder) arr = arr.filter(l => folder.lead_ids.includes(l.id));
    }
    const q = chatSearch.toLowerCase().replace("@","");
    if (q) arr = arr.filter(l =>
      l.full_name.toLowerCase().includes(q) ||
      l.tg_username.toLowerCase().includes(q) ||
      l.tg_user_id.includes(q)
    );
    if (chatFilterStatuses.length) arr = arr.filter(l => chatFilterStatuses.includes(l.status));
    if (chatFilterDateFrom) arr = arr.filter(l => l.delivery_date >= chatFilterDateFrom);
    if (chatFilterDateTo) arr = arr.filter(l => l.delivery_date <= chatFilterDateTo);
    arr.sort((a, b) => {
      const ma = lastMsgMap[a.id]?.sent_at || a.created_at;
      const mb = lastMsgMap[b.id]?.sent_at || b.created_at;
      return new Date(mb).getTime() - new Date(ma).getTime();
    });
    return arr;
  }, [leads, isAdmin, currentUser, showArchivedChats, archivedChats, disabledTgPhones, chatAccountFilter, chatActiveFolderId, chatFolders, chatSearch, chatFilterStatuses, chatFilterDateFrom, chatFilterDateTo, lastMsgMap]);

  const selectedLead = useMemo(() => leads.find(l => l.id === chatSelectedLeadId) || null, [leads, chatSelectedLeadId]);

  // ── Send message ──
  const sendMessage = async () => {
    if (!selectedLead || (!chatInput.trim() && !chatMediaFile)) return;
    setChatSending(true);
    // Всегда отвечаем с аккаунта лида — sendFromPhone только если явно переключили
    const phone = getPhoneForLead(selectedLead) || sendFromPhone;
    const target = (selectedLead.tg_username && selectedLead.tg_username.trim() !== "")
      ? selectedLead.tg_username
      : (selectedLead.tg_user_id && selectedLead.tg_user_id.trim() !== "")
        ? selectedLead.tg_user_id
        : null;
    if (!target) { showToast("❌ Нет username или ID пользователя"); return; }
    const text = chatInput.trim();
    const tempId = Date.now() + Math.random();
    const newMsg: ChatMessage = {
      id: tempId, lead_id: selectedLead.id, tg_account_id: selectedLead.tg_account_id,
      direction: "outgoing", text: chatMediaFile ? `[${chatMediaFile.name}]` : text,
      sent_at: new Date().toISOString(), media_url: chatMediaPreview, media_type: chatMediaFile?.type.startsWith("image") ? "photo" : chatMediaFile ? "document" : "",
    };
    setActiveMessages(prev => [...prev, newMsg]);
    setChatInput("");
    setShowQuickReplies(false);
    setChatMediaFile(null);
    setChatMediaPreview("");
    if (chatMediaFile) {
      const fd = new FormData();
      fd.append("phone", phone);
      fd.append("username", target);
      fd.append("file", chatMediaFile);
      try {
        await fetch(`${BACKEND_URL}/api/send-media`, { method: "POST", headers: { "bypass-tunnel-reminder": "true" }, body: fd });
      } catch { }
    } else if (text) {
      await api.sendMessage(phone, target, text);
    }
    await idbPutMessage(newMsg);
    setLastMsgMap(prev => ({ ...prev, [selectedLead.id]: newMsg }));
    setChatSending(false);
  };

  // ── Load dialogs ──
  const loadDialogs = async (phone: string, label: string) => {
    setDialogLoading(true);
    setDialogProgress({ loaded: 0, total: 0 });
    try {
      const res = await api.getDialogs(phone);
      if (!res.dialogs?.length) { showToast(`${label}: диалоги не найдены`); return; }
      const dialogs = res.dialogs;
      setDialogProgress({ loaded: 0, total: dialogs.length });
      const newLeads: Lead[] = [];
      for (let i = 0; i < dialogs.length; i++) {
        const d = dialogs[i];
        setDialogProgress({ loaded: i + 1, total: dialogs.length });
        const existing = leads.find(l => l.tg_user_id === String(d.id) || (d.username && l.tg_username === d.username));
        if (!existing) {
          const accIdx = realTgAccounts.findIndex(a => normPhone(a.phone) === normPhone(phone));
          const accId = accIdx >= 0 ? 10000 + accIdx : 0;
          newLeads.push({
            id: Date.now() + i + Math.random(),
            tg_user_id: String(d.id), tg_username: d.username || "",
            full_name: d.name || d.username || String(d.id),
            phone: d.phone || "", source: "telegram",
            tg_account_id: accId, tg_account_phone: phone,
            offer_id: 0, cabinet_id: null, status: "новый",
            delivery_date: "", delivery_address: "",
            is_paid: false, paid_date: "", reward_paid: 0,
            in_tg_folder: false, chat_deleted: false, deleted_by: "",
            notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          });
        } else {
          setLeads(prev => prev.map(l =>
            (l.tg_user_id === String(d.id) || (d.username && l.tg_username === d.username))
              ? { ...l, tg_account_phone: phone, full_name: d.name || l.full_name }
              : l
          ));
        }
        if (d.last_message) {
          const lid = existing?.id || (newLeads[newLeads.length-1]?.id);
          if (lid) {
            const msg: ChatMessage = {
              id: Date.now() + i + 0.5 + Math.random(), lead_id: lid, tg_account_id: 0,
              direction: "incoming", text: d.last_message, sent_at: d.last_date || new Date().toISOString(),
            };
            await idbPutMessage(msg);
            setLastMsgMap(prev => {
              const cur = prev[lid];
              if (!cur || new Date(msg.sent_at) > new Date(cur.sent_at)) return { ...prev, [lid]: msg };
              return prev;
            });
          }
        }
      }
      if (newLeads.length) setLeads(prev => [...prev, ...newLeads]);
      showToast(`✅ ${label}: ${dialogs.length} диалогов, +${newLeads.length} новых`);
    } catch (e) {
      showToast("❌ Ошибка загрузки");
    } finally {
      setDialogLoading(false);
    }
  };

  // ── Stats helpers ──
  const getStatsDateRange = () => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    if (statsRange === "today") return { from: today, to: today };
    if (statsRange === "yesterday") {
      const y = new Date(now); y.setDate(y.getDate()-1);
      const ys = y.toISOString().split("T")[0];
      return { from: ys, to: ys };
    }
    if (statsRange === "week") {
      const w = new Date(now); w.setDate(w.getDate()-6);
      return { from: w.toISOString().split("T")[0], to: today };
    }
    if (statsRange === "month") {
      const m = new Date(now); m.setDate(m.getDate()-29);
      return { from: m.toISOString().split("T")[0], to: today };
    }
    if (statsRange === "all" && statsDateFrom && statsDateTo) return { from: statsDateFrom, to: statsDateTo };
    return { from: "2020-01-01", to: today };
  };

  const filteredStatsLeads = useMemo(() => {
    const { from, to } = getStatsDateRange();
    let arr = [...leads];
    if (statsAccount !== "all") arr = arr.filter(l => l.tg_account_phone === statsAccount);
    return arr.filter(l => l.created_at.split("T")[0] >= from && l.created_at.split("T")[0] <= to);
  }, [leads, statsRange, statsAccount, statsDateFrom, statsDateTo]);

  // ── New lead template ──
  const emptyLead = (): Lead => ({
    id: Date.now(), tg_user_id: "", tg_username: "", full_name: "", phone: "",
    source: "", tg_account_id: 0, tg_account_phone: "", offer_id: 0, cabinet_id: null,
    status: "новый", delivery_date: "", delivery_address: "", is_paid: false,
    paid_date: "", reward_paid: 0, in_tg_folder: false, chat_deleted: false,
    deleted_by: "", notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  // ── Nav items ──
  const overdueCount = tasks.filter(t => !t.is_done && new Date(t.due_at) < new Date()).length;
  const navItems = [
    { id: "leads", icon: <Users size={18} />, label: "Лиды" },
    { id: "chat", icon: <MessageSquare size={18} />, label: "Чат", badge: unreadCount },
    { id: "stats", icon: <BarChart3 size={18} />, label: "Статистика" },
    { id: "balance", icon: <Wallet size={18} />, label: "Баланс" },
    { id: "tasks", icon: <CheckSquare size={18} />, label: "Задачи", badge: overdueCount },
    { id: "settings", icon: <Settings size={18} />, label: "Настройки" },
  ] as const;

  // ════════════════════════════════════════════════════════════════
  // RENDER: LEADS
  // ════════════════════════════════════════════════════════════════
  const renderLeads = () => (
    <div className="animate-fadeUp space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-main)]">Лиды</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{filteredLeads.length} из {leads.length}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Tabs */}
          <div className="flex bg-[var(--bg-elevated)] rounded-xl p-1 border border-[var(--border)]">
            {(["leads","people"] as const).map(t => (
              <button key={t} onClick={() => setLeadsTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${leadsTab===t ? "bg-indigo-600 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-main)]"}`}>
                {t === "leads" ? "Лиды" : "Все люди"}
              </button>
            ))}
          </div>
          {/* View toggle */}
          <div className="flex bg-[var(--bg-elevated)] rounded-xl p-1 border border-[var(--border)]">
            <button onClick={() => setLeadsView("table")} className={`p-1.5 rounded-lg transition-all ${leadsView==="table" ? "bg-indigo-600 text-white" : "text-[var(--text-secondary)]"}`}>
              <LayoutDashboard size={14} />
            </button>
            <button onClick={() => setLeadsView("cards")} className={`p-1.5 rounded-lg transition-all ${leadsView==="cards" ? "bg-indigo-600 text-white" : "text-[var(--text-secondary)]"}`}>
              <Activity size={14} />
            </button>
          </div>
          <button onClick={() => setLeadsShowFilter(v=>!v)} className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${leadsShowFilter ? "bg-indigo-600 text-white border-transparent" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-main)]"}`}>
            <Filter size={13} /> Фильтр
          </button>
          <Btn onClick={() => { setLeadModal(emptyLead()); setLeadModalNew(true); }} size="sm">
            <Plus size={14} /> Добавить
          </Btn>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" />
        <input value={leadsSearch} onChange={e => setLeadsSearch(e.target.value)} placeholder="Поиск по имени, @username, телефону..."
          className="input-base input-with-icon text-sm" />
      </div>

      {/* Filters */}
      {leadsShowFilter && (
        <Card className="p-4 animate-fadeUp">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Статус</label>
              <Select value={leadsFilterStatus} onChange={v => setLeadsFilterStatus(v as LeadStatus|"")}>
                <option value="">Все статусы</option>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Аккаунт</label>
              <Select value={leadsFilterAccount} onChange={v => setLeadsFilterAccount(v ? +v : "")}>
                <option value="">Все аккаунты</option>
                {visibleAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Оффер</label>
              <Select value={leadsFilterOffer} onChange={v => setLeadsFilterOffer(v ? +v : "")}>
                <option value="">Все офферы</option>
                {offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            <div className="flex items-end">
              <Btn variant="ghost" size="sm" onClick={() => { setLeadsFilterStatus(""); setLeadsFilterAccount(""); setLeadsFilterOffer(""); setLeadsSearch(""); }} className="w-full justify-center">
                <X size={13} /> Сбросить
              </Btn>
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-secondary)] mb-2 block font-medium">Сортировка</label>
            <div className="flex flex-wrap gap-2">
              {([
                ["delivery","📅 По дате доставки"],
                ["created","🕐 По дате создания"],
                ["status","📊 По статусу"],
                ["name","🔤 По имени"],
                ["lastmsg","💬 По сообщению"],
              ] as const).map(([field, label]) => (
                <button key={field} onClick={() => handleSort(field as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${leadsSort===field ? "bg-indigo-600 text-white border-transparent" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-main)]"}`}>
                  {label} {leadsSort===field && <span className="ml-0.5">{leadsSortDir==="asc"?"↑":"↓"}</span>}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Leads content */}
      {leadsView === "table" ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    {["Лид","Статус","Оффер","Доставка","Аккаунт",""].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredLeads.map((lead, i) => {
                    const offer = offers.find(o => o.id === lead.offer_id);
                    const pn = offer?.type === "partner" ? partnerNetworks.find(p => p.id === offer.partner_network_id) : null;
                    const unread = unreadMap[lead.id] || 0;
                    return (
                      <tr key={lead.id} onClick={() => { setLeadModal(lead); setLeadModalNew(false); }}
                        className="hover:bg-[var(--bg-elevated)] cursor-pointer transition-colors group animate-fadeUp"
                        style={{ animationDelay: `${i*0.03}s` }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar url={avatarCache[lead.tg_username]} name={lead.full_name||lead.tg_username} id={lead.id} size={34} />
                              {unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}
                            </div>
                            <div>
                              <div className="font-medium text-[var(--text-main)] text-sm">{lead.full_name || "—"}</div>
                              <div className="text-xs text-[var(--text-secondary)]">@{lead.tg_username || lead.tg_user_id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div onClick={e => { e.stopPropagation(); setStatusDropdown({ lead, el: e.currentTarget as HTMLElement }); }}>
                            <StatusBadge status={lead.status} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {lead.status === "новый" ? (
                            <span className="text-xs text-[var(--text-secondary)] italic">Не оформлен</span>
                          ) : offer ? (
                            <div>
                              <div className="text-xs font-medium text-[var(--text-main)]">{offer.name}</div>
                              {pn && isAdmin && <div className="text-xs text-[var(--text-secondary)]">{pn.name}</div>}
                              {pn && !isAdmin && <div className="text-xs text-[var(--text-secondary)]">🔒 скрыто</div>}
                            </div>
                          ) : <span className="text-xs text-[var(--text-secondary)] italic">Не выбран</span>}
                        </td>
                        <td className="px-4 py-3">
                          {lead.delivery_date ? (
                            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                              <Calendar size={12} className="text-indigo-400" />
                              {fmtDate(lead.delivery_date)}
                            </div>
                          ) : <span className="text-xs text-[var(--text-secondary)]">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-[var(--text-secondary)]">{lead.tg_account_phone || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={e => { e.stopPropagation(); openChat(lead.id); setPage("chat"); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-indigo-500/20 text-indigo-400">
                            <MessageCircle size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredLeads.length && (
                    <tr><td colSpan={6} className="text-center py-16 text-[var(--text-secondary)]">
                      <Users size={32} className="mx-auto mb-3 opacity-30" />
                      <div className="text-sm">Лиды не найдены</div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLeads.map((lead, i) => {
              const offer = offers.find(o => o.id === lead.offer_id);
              const pn = offer?.type === "partner" ? partnerNetworks.find(p => p.id === offer.partner_network_id) : null;
              const unread = unreadMap[lead.id] || 0;
              const lastMsg = lastMsgMap[lead.id];
              return (
                <Card key={lead.id} hover onClick={() => { setLeadModal(lead); setLeadModalNew(false); }}
                  className="p-4 animate-fadeUp" style={{ animationDelay: `${i*0.04}s` } as React.CSSProperties}>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="relative">
                      <Avatar url={avatarCache[lead.tg_username]} name={lead.full_name||lead.tg_username} id={lead.id} size={40} />
                      {unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">{unread}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-[var(--text-main)] truncate">{lead.full_name||"—"}</div>
                      <div className="text-xs text-[var(--text-secondary)]">@{lead.tg_username||lead.tg_user_id}</div>
                    </div>
                    <StatusBadge status={lead.status} size="xs" />
                  </div>
                  {lastMsg && <div className="text-xs text-[var(--text-secondary)] truncate mb-3 p-2 bg-[var(--bg-elevated)] rounded-lg">{lastMsg.direction==="outgoing"?"→ ":""}{lastMsg.text}</div>}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-secondary)]">{lead.status==="новый" ? "Не оформлен" : offer?.name || "Не выбран"}</span>
                    <div className="flex gap-1">
                      <button onClick={e => { e.stopPropagation(); openChat(lead.id); setPage("chat"); }}
                        className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-indigo-400 transition-colors">
                        <MessageCircle size={14} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
            {!filteredLeads.length && <div className="col-span-3 text-center py-16 text-[var(--text-secondary)]">Лиды не найдены</div>}
          </div>
        )
      }
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // RENDER: LEAD MODAL
  // ════════════════════════════════════════════════════════════════
  // renderLeadModal заменён на LeadModalForm компонент выше

  // ════════════════════════════════════════════════════════════════
  // RENDER: CHAT
  // ════════════════════════════════════════════════════════════════
  const renderChat = () => {
    const filteredQR = [...tgQuickReplies, ...quickReplies.filter(r => r.is_active)].filter(r =>
      quickReplySearch ? r.shortcut.toLowerCase().includes(quickReplySearch.toLowerCase()) || r.text.toLowerCase().includes(quickReplySearch.toLowerCase()) : true
    );
    const accOptions = realTgAccounts.filter(a => !disabledTgPhones.includes(a.phone));

    return (
      <div className="h-[calc(100vh-80px)] flex animate-fadeIn" style={{ margin: "0", overflow: "hidden" }}>
        {/* Left panel */}
        <div className={`${chatMobileShowList ? "flex" : "hidden"} md:flex flex-col border-r border-[var(--border)] shrink-0`} style={{ width: 320, minWidth: 320, maxWidth: 320, overflow: "hidden", flexShrink: 0, background: "var(--bg-card)" }}>
          {/* Chat header */}
          <div className="p-3 border-b border-[var(--border)] space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" />
                <input value={chatSearch} onChange={e => setChatSearch(e.target.value)} placeholder="Поиск диалогов..."
                  className="input-base input-with-icon text-xs py-2" />
              </div>
              <button onClick={() => setChatShowFilter(v=>!v)} className={`p-2 rounded-xl border transition-all ${chatShowFilter ? "bg-indigo-600 text-white border-transparent" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
                <Filter size={14} />
              </button>
            </div>

            {/* Account selector */}
            {accOptions.length > 1 && (
              <Select value={chatAccountFilter} onChange={v => setChatAccountFilter(v)} className="text-xs py-1.5">
                <option value="all">Все аккаунты</option>
                {accOptions.map(a => <option key={a.phone} value={a.phone}>{a.label}</option>)}
              </Select>
            )}

            {/* Filter panel */}
            {chatShowFilter && (
              <div className="space-y-2 pt-1 animate-fadeUp">
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="date" value={chatFilterDateFrom} onChange={v => setChatFilterDateFrom(v)} placeholder="От" className="text-xs py-1.5" />
                  <Input type="date" value={chatFilterDateTo} onChange={v => setChatFilterDateTo(v)} placeholder="До" className="text-xs py-1.5" />
                </div>
                <div className="flex flex-wrap gap-1">
                  {ALL_STATUSES.slice(0,6).map(s => (
                    <button key={s} onClick={() => setChatFilterStatuses(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev,s])}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${chatFilterStatuses.includes(s) ? "bg-indigo-600 text-white border-transparent" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={showArchivedChats} onChange={e => setShowArchivedChats(e.target.checked)} className="accent-indigo-500" />
                  📁 Архив ({archivedChats.length})
                </label>
                {(chatFilterStatuses.length > 0 || !!chatFilterDateFrom || !!chatFilterDateTo || showArchivedChats) && (
                  <button onClick={() => { setChatFilterStatuses([]); setChatFilterDateFrom(""); setChatFilterDateTo(""); setShowArchivedChats(false); }}
                    className="text-xs text-red-400 hover:text-red-300">× Сбросить фильтры</button>
                )}
              </div>
            )}

            {/* Folders */}
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
              <button onClick={() => setChatActiveFolderId(null)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap border transition-all ${chatActiveFolderId===null ? "bg-indigo-600 text-white border-transparent" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
                Все
              </button>
              {chatFolders.map(f => (
                <div key={f.id} className="relative group/folder">
                  <button onClick={() => setChatActiveFolderId(f.id)}
                    className={`px-3 py-1 rounded-full text-xs whitespace-nowrap border transition-all pr-6 ${chatActiveFolderId===f.id ? "bg-indigo-600 text-white border-transparent" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
                    {f.name}
                  </button>
                  <button onClick={() => setChatFolders(prev=>prev.filter(x=>x.id!==f.id))}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/folder:opacity-100 transition-opacity text-[10px]">×</button>
                </div>
              ))}
              {showNewFolder ? (
                <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key==="Enter" && newFolderName.trim()) { setChatFolders(prev=>[...prev,{id:Date.now(),name:newFolderName.trim(),lead_ids:[]}]); setNewFolderName(""); setShowNewFolder(false); } if (e.key==="Escape") setShowNewFolder(false); }}
                  onBlur={() => setShowNewFolder(false)}
                  className="px-2 py-1 rounded-full text-xs border border-indigo-500 bg-[var(--bg-elevated)] text-[var(--text-main)] outline-none w-24" />
              ) : (
                <button onClick={() => setShowNewFolder(true)} className="px-2 py-1 rounded-full text-xs border border-dashed border-[var(--border)] text-[var(--text-secondary)] hover:border-indigo-500 transition-colors whitespace-nowrap">
                  + папка
                </button>
              )}
            </div>
          </div>

          {/* Dialogs list */}
          <div className="flex-1 overflow-y-auto">
            {chatLeads.length === 0 ? (
              <div className="text-center py-12">
                <MessageSquare size={32} className="mx-auto mb-3 text-[var(--text-muted)]" />
                <p className="text-sm text-[var(--text-secondary)]">Нет диалогов</p>
                {realTgAccounts.filter(a => !disabledTgPhones.includes(a.phone)).length > 0 && (
                  <p className="text-xs text-[var(--text-secondary)] mt-1">Нажмите кнопку загрузки ниже</p>
                )}
              </div>
            ) : chatLeads.slice(0, chatVisibleCount).map((lead, i) => {
              const lastMsg = lastMsgMap[lead.id];
              const unread = unreadMap[lead.id] || 0;
              const isMuted = mutedLeads.includes(lead.id);
              const isActive = chatSelectedLeadId === lead.id;
              const acc = realTgAccounts.find(a => normPhone(a.phone) === normPhone(lead.tg_account_phone));
              return (
                <div key={lead.id}
                  onClick={() => openChat(lead.id)}
                  onContextMenu={e => { e.preventDefault(); setChatContextMenu({ leadId: lead.id, x: e.clientX, y: e.clientY }); }}
                  className={`flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors relative group/dialog border-b border-[var(--border)]/50 animate-fadeUp ${isActive ? "bg-indigo-600/10 border-l-2 border-l-indigo-500" : "hover:bg-[var(--bg-elevated)]"}`}
                  style={{ animationDelay: `${i*0.02}s` }}>
                  <div className="relative shrink-0">
                    <Avatar url={avatarCache[lead.tg_username]} name={lead.full_name||lead.tg_username} id={lead.id} size={40} />
                    {isMuted && <VolumeX size={10} className="absolute -bottom-0.5 -right-0.5 bg-[var(--bg-card)] rounded-full text-[var(--text-secondary)] p-0.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-sm font-medium truncate ${isActive ? "text-indigo-400" : "text-[var(--text-main)]"}`}>
                        {lead.full_name || lead.tg_username || lead.tg_user_id}
                      </span>
                      <span className="text-[10px] text-[var(--text-secondary)] shrink-0 ml-2">{lastMsg ? fmtRelative(lastMsg.sent_at) : ""}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-[var(--text-secondary)] truncate flex-1">
                        {lastMsg ? (lastMsg.direction==="outgoing" ? `↑ ${lastMsg.text}` : lastMsg.text) : acc ? <span className="text-indigo-400/70 text-[10px]">📱 {acc.label}</span> : ""}
                      </p>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <StatusBadge status={lead.status} size="xs" />
                        {unread > 0 && !isMuted && <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{unread}</span>}
                      </div>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setChatContextMenu({ leadId: lead.id, x: e.clientX, y: e.clientY }); }}
                    className="opacity-0 group-hover/dialog:opacity-100 transition-opacity p-1 rounded-lg hover:bg-[var(--bg-main)] text-[var(--text-secondary)] shrink-0">
                    <MoreVertical size={13} />
                  </button>
                </div>
              );
            })}
            
            {/* Кнопка "Показать ещё" — виртуализация */}
            {chatLeads.length > chatVisibleCount && (
              <button
                onClick={() => setChatVisibleCount(v => v + 50)}
                className="w-full py-3 text-sm text-indigo-400 hover:text-indigo-300 hover:bg-[var(--bg-elevated)] transition-colors border-t border-[var(--border)]"
              >
                Показать ещё {Math.min(50, chatLeads.length - chatVisibleCount)} из {chatLeads.length - chatVisibleCount} диалогов...
              </button>
            )}
          </div>

          {/* Load dialogs buttons */}
          <div className="p-3 border-t border-[var(--border)] space-y-2">
            {dialogLoading && (
              <div className="text-xs text-[var(--text-secondary)] flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin text-indigo-400" />
                Загружено {dialogProgress.loaded} / {dialogProgress.total}
                <div className="flex-1 h-1 bg-[var(--border)] rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: dialogProgress.total ? `${(dialogProgress.loaded/dialogProgress.total)*100}%` : "0%" }} />
                </div>
              </div>
            )}
            {realTgAccounts.filter(a => !disabledTgPhones.includes(a.phone)).map(acc => (
              <button key={acc.phone} onClick={() => loadDialogs(acc.phone, acc.label)} disabled={dialogLoading}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors border border-indigo-500/20 disabled:opacity-50">
                <RefreshCw size={12} className={dialogLoading ? "animate-spin" : ""} />
                {acc.label}
              </button>
            ))}
            {realTgAccounts.length === 0 && (
              <p className="text-xs text-[var(--text-secondary)] text-center">Подключите TG аккаунт в Настройках</p>
            )}
          </div>
        </div>

        {/* Right panel: Chat */}
        <div className={`${!chatMobileShowList ? "flex" : "hidden"} md:flex flex-col flex-1 min-w-0`}
          style={{ background: "var(--bg-main)" }}>
          {selectedLead ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0"
                style={{ background: "var(--bg-card)" }}>
                <button onClick={() => setChatMobileShowList(true)} className="md:hidden p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => setChatProfileOpen(true)} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                  <Avatar url={avatarCache[selectedLead.tg_username]} name={selectedLead.full_name||selectedLead.tg_username} id={selectedLead.id} size={38} />
                  <div className="text-left">
                    <div className="font-semibold text-sm text-[var(--text-main)]">{selectedLead.full_name||selectedLead.tg_username}</div>
                    <div className="text-xs text-[var(--text-secondary)]">@{selectedLead.tg_username} · <StatusBadge status={selectedLead.status} size="xs" /></div>
                  </div>
                </button>
                <div className="ml-auto flex items-center gap-2">
                  {/* Delivery date */}
                  {chatEditDelivery ? (
                    <div className="flex items-center gap-2">
                      <input type="date" value={chatDeliveryInput} onChange={e => setChatDeliveryInput(e.target.value)}
                        className="input-base text-xs py-1 w-36" />
                      <button onClick={() => {
                        setLeads(prev => prev.map(l => l.id===selectedLead.id ? {...l,delivery_date:chatDeliveryInput} : l));
                        setChatEditDelivery(false); showToast("✅ Дата доставки сохранена");
                      }} className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400"><Check size={14} /></button>
                      <button onClick={() => setChatEditDelivery(false)} className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"><X size={14} /></button>
                    </div>
                  ) : (
                    <button onClick={() => { setChatEditDelivery(true); setChatDeliveryInput(selectedLead.delivery_date||""); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs border border-[var(--border)] hover:border-indigo-500 text-[var(--text-secondary)] hover:text-indigo-400 transition-all">
                      <Calendar size={12} />
                      {selectedLead.delivery_date ? fmtDate(selectedLead.delivery_date) : "+ Дата доставки"}
                    </button>
                  )}
                  <button onClick={() => toggleMute(selectedLead.id)}
                    className={`p-2 rounded-xl border transition-all ${mutedLeads.includes(selectedLead.id) ? "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-secondary)]" : "border-transparent text-indigo-400"}`}>
                    {mutedLeads.includes(selectedLead.id) ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                  {selectedLead.tg_username && (
                    <a href={`https://t.me/${selectedLead.tg_username}`} target="_blank" rel="noreferrer"
                      className="p-2 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-indigo-400 hover:border-indigo-500 transition-all">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  <button onClick={() => { if (confirm(`Скрыть чат с «${selectedLead.full_name}»?`)) { toggleArchive(selectedLead.id, true); setChatSelectedLeadId(null); setChatMobileShowList(true); } }}
                    className="p-2 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:text-orange-400 hover:border-orange-500/50 transition-all">
                    <Archive size={15} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {activeMessages.length === 0 && (
                  <div className="text-center py-16">
                    <MessageCircle size={40} className="mx-auto mb-3 text-[var(--text-muted)]" />
                    <p className="text-sm text-[var(--text-secondary)]">Нет сообщений</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Начните переписку</p>
                  </div>
                )}
                {activeMessages.map((msg, i) => {
                  const isOut = msg.direction === "outgoing";
                  const accName = realTgAccounts.find(a => normPhone(a.phone) === normPhone(selectedLead.tg_account_phone))?.label;
                  const showTime = i === 0 || new Date(activeMessages[i-1].sent_at).getMinutes() !== new Date(msg.sent_at).getMinutes();
                  return (
                    <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"} animate-fadeUp`}>
                      <div className={`max-w-[72%] ${isOut ? "" : "flex gap-2"}`}>
                        {!isOut && <Avatar url={avatarCache[selectedLead.tg_username]} name={selectedLead.full_name||""} id={selectedLead.id} size={28} />}
                        <div>
                          {isOut && accName && <div className="text-[10px] text-[var(--text-secondary)] text-right mb-1 flex items-center gap-1 justify-end"><Phone size={10} />{accName}</div>}
                          {!isOut && accName && <div className="text-[10px] text-[var(--text-secondary)] mb-1 flex items-center gap-1"><Phone size={10} />{accName}</div>}
                          <div className={`px-4 py-2.5 rounded-2xl text-sm ${isOut ? "bubble-out" : "bubble-in"}`}>
                            {msg.media_url && (() => {
                              const mUrl = msg.media_url.startsWith('http') ? msg.media_url : `${BACKEND_URL}${msg.media_url}`;
                              return msg.media_type === "photo" ? (
                                <img src={mUrl} alt="media" className="rounded-xl max-w-full mb-2 cursor-pointer" style={{ maxHeight: 200 }} onClick={() => window.open(mUrl, '_blank')} />
                              ) : msg.media_type === "video" ? (
                                <video src={mUrl} controls className="rounded-xl max-w-full mb-2" style={{ maxHeight: 200 }} />
                              ) : (
                                <a href={mUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-indigo-300 underline mb-2 text-xs">
                                  <FileText size={14} /> {msg.media_url.split('/').pop() || 'Файл'}
                                </a>
                              );
                            })()}
                            {msg.text && <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>}
                          </div>
                          {showTime && <div className={`text-[10px] text-[var(--text-secondary)] mt-1 ${isOut ? "text-right" : ""}`}>{fmtTime(msg.sent_at)}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {/* Quick replies dropdown */}
              {showQuickReplies && filteredQR.length > 0 && (
                <div className="mx-4 mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl max-h-48 overflow-y-auto animate-scaleIn">
                  <div className="p-2 border-b border-[var(--border)] flex items-center gap-2">
                    <Zap size={12} className="text-indigo-400" />
                    <span className="text-xs text-[var(--text-secondary)]">Быстрые ответы</span>
                  </div>
                  {filteredQR.map(r => (
                    <button key={r.shortcut} onClick={() => { setChatInput(r.text); setShowQuickReplies(false); setChatInput(r.text); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors text-left">
                      <span className="font-mono text-[11px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded shrink-0">/{r.shortcut}</span>
                      <span className="text-xs text-[var(--text-secondary)] truncate">{r.text}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Media preview */}
              {chatMediaPreview && (
                <div className="mx-4 mb-2 relative inline-block">
                  <img src={chatMediaPreview} alt="preview" className="h-20 rounded-xl border border-[var(--border)]" />
                  <button onClick={() => { setChatMediaFile(null); setChatMediaPreview(""); }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white">
                    <X size={10} />
                  </button>
                </div>
              )}

              {/* Input area */}
              <div className="px-4 py-3 border-t border-[var(--border)] shrink-0" style={{ background: "var(--bg-card)" }}>
                {/* Send from account selector */}
                {realTgAccounts.filter(a => !disabledTgPhones.includes(a.phone)).length > 1 && (
                  <div className="flex items-center gap-2 mb-2">
                    <Phone size={12} className="text-[var(--text-secondary)]" />
                    <Select value={sendFromPhone} onChange={v => setSendFromPhone(v)} className="text-xs py-1 flex-1">
                      <option value="">— выбрать аккаунт —</option>
                      {realTgAccounts.filter(a => !disabledTgPhones.includes(a.phone)).map(a => (
                        <option key={a.phone} value={a.phone}>{a.label} ({a.phone})</option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <button onClick={() => chatFileRef.current?.click()} className="p-2.5 rounded-xl hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-indigo-400 transition-colors shrink-0">
                    <Paperclip size={18} />
                  </button>
                  <input ref={chatFileRef} type="file" accept="image/*,video/*,*" className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setChatMediaFile(f);
                      if (f.type.startsWith("image/")) { const r = new FileReader(); r.onload = ev => setChatMediaPreview(ev.target?.result as string); r.readAsDataURL(f); }
                      else setChatMediaPreview("");
                    }} />
                  <div className="flex-1 relative">
                    <textarea value={chatInput}
                      onChange={e => {
                        setChatInput(e.target.value);
                        if (e.target.value.startsWith("/")) { setShowQuickReplies(true); setQuickReplySearch(e.target.value.slice(1)); }
                        else { setShowQuickReplies(false); setQuickReplySearch(""); }
                      }}
                      onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                      placeholder="Напишите сообщение... (/ — быстрые ответы)"
                      rows={1}
                      className="input-base resize-none pr-12 py-3 text-sm"
                      style={{ maxHeight: 120, overflowY: "auto" }}
                    />
                  </div>
                  <button onClick={sendMessage} disabled={chatSending || (!chatInput.trim() && !chatMediaFile)}
                    className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-lg shadow-indigo-900/30">
                    {chatSending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(124,58,237,0.1))", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <MessageSquare size={36} className="text-indigo-400" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-main)] mb-2">Выберите диалог</h3>
                <p className="text-sm text-[var(--text-secondary)]">Нажмите на контакт слева</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER: CHAT PROFILE
  // ════════════════════════════════════════════════════════════════
  const renderChatProfile = () => {
    if (!selectedLead) return null;
    const draft = chatProfileEditing ? chatProfileDraft : selectedLead;
    const selectedOffer = offers.find(o => o.id === (draft as Lead).offer_id);
    const pn = selectedOffer?.type === "partner" ? partnerNetworks.find(p => p.id === selectedOffer.partner_network_id) : null;
    const offerCabinets = cabinets.filter(c => c.offer_id === (draft as Lead).offer_id && !c.is_archived);

    return (
      <Modal title="Профиль" onClose={() => { setChatProfileOpen(false); setChatProfileEditing(false); }}>
        <div className="text-center mb-6">
          <Avatar url={avatarCache[selectedLead.tg_username]} name={selectedLead.full_name||selectedLead.tg_username} id={selectedLead.id} size={72} />
          <h3 className="font-bold text-lg text-[var(--text-main)] mt-3">{selectedLead.full_name||"—"}</h3>
          <p className="text-sm text-[var(--text-secondary)]">@{selectedLead.tg_username}</p>
          <div className="mt-2"><StatusBadge status={selectedLead.status} size="md" /></div>
        </div>
        {chatProfileEditing ? (
          <div className="space-y-3">
            {[["Имя","full_name"],["Username","tg_username"],["Телефон","phone"],["Источник","source"]] .map(([label, key]) => (
              <div key={key}>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">{label}</label>
                <Input value={(chatProfileDraft as any)[key]||""} onChange={v => setChatProfileDraft(p=>({...p,[key]:v}))} placeholder={label} />
              </div>
            ))}
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Статус</label>
              <Select value={chatProfileDraft.status||""} onChange={v => setChatProfileDraft(p=>({...p,status:v as LeadStatus}))}>
                {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Оффер</label>
              <Select value={chatProfileDraft.offer_id||0} onChange={v => setChatProfileDraft(p=>({...p,offer_id:+v,cabinet_id:null}))}>
                <option value={0}>— не выбран —</option>
                {offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </div>
            {selectedOffer?.type === "lk" && (
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1 block">ЛК Кабинет</label>
                <Select value={chatProfileDraft.cabinet_id||""} onChange={v => setChatProfileDraft(p=>({...p,cabinet_id:v?+v:null}))}>
                  <option value="">— не выбран —</option>
                  {offerCabinets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            )}
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Дата доставки</label>
              <Input type="date" value={chatProfileDraft.delivery_date||""} onChange={v => setChatProfileDraft(p=>({...p,delivery_date:v}))} />
            </div>
            <div>
              <label className="text-xs text-[var(--text-secondary)] mb-1 block">Заметки</label>
              <Input value={chatProfileDraft.notes||""} onChange={v => setChatProfileDraft(p=>({...p,notes:v}))} rows={2} />
            </div>
            <div className="flex gap-2 pt-2">
              <Btn onClick={() => {
                setLeads(prev => prev.map(l => l.id===selectedLead.id ? {...l,...chatProfileDraft,updated_at:new Date().toISOString()} : l));
                setChatProfileEditing(false); showToast("✅ Профиль сохранён");
              }} className="flex-1 justify-center"><Check size={14} /> Сохранить</Btn>
              <Btn variant="secondary" onClick={() => setChatProfileEditing(false)}>Отмена</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {[
              ["📱 Телефон", selectedLead.phone],
              ["🔗 Username", `@${selectedLead.tg_username}`],
              ["📣 Источник", selectedLead.source],
              ["💳 Оффер", selectedLead.status==="новый" ? "Ещё не оформлен" : offers.find(o=>o.id===selectedLead.offer_id)?.name || "Не выбран"],
              ["🤝 Партнёрка", pn ? (isAdmin ? pn.name : "🔒 скрыто") : null],
              ["📅 Доставка", selectedLead.delivery_date ? fmtDate(selectedLead.delivery_date) : null],
              ["📍 Адрес", selectedLead.delivery_address],
              ["📝 Заметки", selectedLead.notes],
            ].filter(([,v]) => v).map(([label, value]) => (
              <div key={String(label)} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-elevated)]">
                <span className="text-sm text-[var(--text-secondary)] w-28 shrink-0">{label}</span>
                <span className="text-sm text-[var(--text-main)] flex-1">{value}</span>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Btn onClick={() => { setChatProfileEditing(true); setChatProfileDraft({...selectedLead}); }} variant="secondary" className="flex-1 justify-center">
                <Edit2 size={14} /> Редактировать
              </Btn>
              {selectedLead.tg_username && (
                <a href={`https://t.me/${selectedLead.tg_username}`} target="_blank" rel="noreferrer">
                  <Btn variant="ghost"><ExternalLink size={14} /> Открыть в TG</Btn>
                </a>
              )}
            </div>
          </div>
        )}
      </Modal>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER: BALANCE
  // ════════════════════════════════════════════════════════════════
  const renderBalance = () => {
    const now2 = new Date();
    const balancePeriodStart = (() => {
      const d = new Date();
      if (balancePeriod === "today") { d.setHours(0,0,0,0); return d; }
      if (balancePeriod === "week") { d.setDate(d.getDate()-7); return d; }
      if (balancePeriod === "month") { d.setDate(d.getDate()-30); return d; }
      return null;
    })();
    const visibleHistory = balanceHistory.filter(r => {
      if (!isAdmin && !currentUser.account_ids.includes(r.tg_account_id)) return false;
      if (balanceFilterAccount && r.tg_account_id !== balanceFilterAccount) return false;
      if (balanceFilterType && r.type !== balanceFilterType) return false;
      if (balancePeriodStart && new Date(r.created_at) < balancePeriodStart) return false;
      return true;
    });
    const totalHold = visibleHistory.filter(r=>r.type==="hold"&&r.amount>0).reduce((s,r)=>s+r.amount,0);
    const totalEarned = visibleHistory.filter(r=>r.type==="earned").reduce((s,r)=>s+r.amount,0);
    const totalLeads = leads.filter(l => !isAdmin ? currentUser.account_ids.includes(l.tg_account_id) : true).length;

    return (
      <div className="animate-fadeUp space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-main)]">Баланс</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{isAdmin ? "Все аккаунты" : "Ваши аккаунты"}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: "В холде", value: `${totalHold.toLocaleString()}₽`, icon: <Clock size={20} />, color: "orange", sub: "Ожидает подтверждения" },
            { label: "Заработано", value: `${totalEarned.toLocaleString()}₽`, icon: <TrendingUp size={20} />, color: "emerald", sub: "Подтверждённый доход" },
            { label: "Лидов всего", value: totalLeads, icon: <Users size={20} />, color: "indigo", sub: "Все контакты" },
          ].map(({ label, value, icon, color, sub }, i) => (
            <Card key={label} className={`p-5 animate-fadeUp delay-${i+1}`}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{label}</span>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center`}
                  style={{ background: color === "orange" ? "rgba(249,115,22,0.15)" : color === "emerald" ? "rgba(16,185,129,0.15)" : "rgba(99,102,241,0.15)", color: color === "orange" ? "#f97316" : color === "emerald" ? "#10b981" : "#6366f1" }}>
                  {icon}
                </div>
              </div>
              <div className="text-2xl font-bold text-[var(--text-main)]">{value}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-1">{sub}</div>
            </Card>
          ))}
        </div>

        {/* По аккаунтам — для админа */}
        {isAdmin && (
          <div>
            <h3 className="font-semibold text-[var(--text-main)] mb-3">📱 По аккаунтам</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {accounts.map(acc => {
                const accHistory = balanceHistory.filter(r => r.tg_account_id === acc.id);
                const accHold = accHistory.filter(r=>r.type==="hold"&&r.amount>0).reduce((s,r)=>s+r.amount,0);
                const accEarned = accHistory.filter(r=>r.type==="earned").reduce((s,r)=>s+r.amount,0);
                const accLeads = leads.filter(l=>l.tg_account_id===acc.id).length;
                const accPaid = leads.filter(l=>l.tg_account_id===acc.id&&l.is_paid).length;
                return (
                  <Card key={acc.id} className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div style={{ width:36, height:36, borderRadius:"50%", background:avatarColor(acc.id), display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, flexShrink:0 }}>
                        {avatarText(acc.label)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-[var(--text-main)] truncate">{acc.label}</div>
                        <div className="text-xs text-[var(--text-secondary)]">{acc.phone}</div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${acc.is_active ? "bg-emerald-400" : "bg-red-400"}`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "В холде", value: `${accHold.toLocaleString()}₽`, color: "#f97316" },
                        { label: "Заработано", value: `${accEarned.toLocaleString()}₽`, color: "#10b981" },
                        { label: "Лидов", value: accLeads, color: "#6366f1" },
                        { label: "Оплачено", value: accPaid, color: "#8b5cf6" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="p-2 rounded-xl" style={{ background: "var(--bg-elevated)" }}>
                          <div className="text-xs text-[var(--text-secondary)] mb-0.5">{label}</div>
                          <div className="font-bold text-sm" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* По менеджерам — для админа */}
        {isAdmin && users.filter(u=>u.role==="manager").length > 0 && (
          <div>
            <h3 className="font-semibold text-[var(--text-main)] mb-3">👥 По менеджерам</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {users.filter(u=>u.role==="manager").map(u => {
                const mgrLeads = leads.filter(l => u.account_ids.includes(l.tg_account_id));
                const mgrPaid = mgrLeads.filter(l=>l.is_paid).length;
                const mgrHold = balanceHistory.filter(r=>u.account_ids.includes(r.tg_account_id)&&r.type==="hold"&&r.amount>0).reduce((s,r)=>s+r.amount,0);
                const mgrEarned = balanceHistory.filter(r=>u.account_ids.includes(r.tg_account_id)&&r.type==="earned").reduce((s,r)=>s+r.amount,0);
                const mgrAccNames = accounts.filter(a=>u.account_ids.includes(a.id)).map(a=>a.label).join(", ") || "—";
                return (
                  <Card key={u.id} className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div style={{ width:36, height:36, borderRadius:"50%", background:avatarColor(u.id), display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:12, fontWeight:700, flexShrink:0 }}>
                        {avatarText(u.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-[var(--text-main)] truncate">{u.name}</div>
                        <div className="text-xs text-[var(--text-secondary)] truncate">Аккаунты: {mgrAccNames}</div>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${u.is_blocked ? "bg-red-400" : "bg-emerald-400"}`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "В холде", value: `${mgrHold.toLocaleString()}₽`, color: "#f97316" },
                        { label: "Заработано", value: `${mgrEarned.toLocaleString()}₽`, color: "#10b981" },
                        { label: "Лидов", value: mgrLeads.length, color: "#6366f1" },
                        { label: "Оплачено", value: mgrPaid, color: "#8b5cf6" },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="p-2 rounded-xl" style={{ background: "var(--bg-elevated)" }}>
                          <div className="text-xs text-[var(--text-secondary)] mb-0.5">{label}</div>
                          <div className="font-bold text-sm" style={{ color }}>{value}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-[var(--text-main)]">История операций</h3>
            <div className="flex gap-2">
              <Select value={balanceFilterType} onChange={v => setBalanceFilterType(v as any)} className="text-xs py-1.5 w-36">
                <option value="">Все типы</option>
                <option value="hold">Холд</option>
                <option value="earned">Оплачено</option>
                <option value="withdrawal">Вывод средств</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            {visibleHistory.length === 0 && <div className="text-center py-12 text-[var(--text-secondary)]"><Wallet size={32} className="mx-auto mb-3 opacity-30" /><p className="text-sm">Нет операций</p></div>}
            {visibleHistory.map(r => {
              const isPos = r.amount > 0;
              const typeIcon = r.type === "hold" ? "⏳" : r.type === "earned" ? "✅ Оплачено" : "📤 Вывод";
              return (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--bg-elevated)] transition-colors">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
                    style={{ background: isPos ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)" }}>
                    {typeIcon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-main)] truncate">{r.description}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{fmtDate(r.created_at)} · {fmtTime(r.created_at)}</div>
                  </div>
                  <div className={`font-bold text-sm shrink-0 ${isPos ? "text-emerald-400" : "text-red-400"}`}>
                    {isPos ? "+" : ""}{r.amount.toLocaleString()}₽
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER: TASKS
  // ════════════════════════════════════════════════════════════════
  const renderTasks = () => {
    const sorted = [...tasks].sort((a, b) => {
      if (a.is_done !== b.is_done) return a.is_done ? 1 : -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });
    const active = tasks.filter(t => !t.is_done).length;

    return (
      <div className="animate-fadeUp space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-main)]">Задачи</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{active} активных из {tasks.length}</p>
          </div>
          <Btn onClick={() => { setTaskDraft({ due_at: new Date(Date.now()+3600000).toISOString(), lead_ids: [], is_done: false, recipients_count: 1, tg_account_id: 0, notes: "", title: "", created_at: new Date().toISOString() }); setEditTaskId(null); setTaskModal(true); }} size="sm">
            <Plus size={14} /> Новая задача
          </Btn>
        </div>

        <div className="space-y-3">
          {sorted.length === 0 && (
            <Card className="p-12 text-center">
              <CheckSquare size={40} className="mx-auto mb-3 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-secondary)]">Задач нет</p>
            </Card>
          )}
          {sorted.map((task, i) => {
            const { text: timerText, overdue } = countdown(task.due_at);
            const taskLeads = leads.filter(l => task.lead_ids?.includes(l.id));
            return (
              <Card key={task.id} className={`p-4 animate-fadeUp ${overdue && !task.is_done ? "border-red-500/30" : ""}`} style={{ animationDelay: `${i*0.05}s` }}>
                <div className="flex items-start gap-3">
                  <button onClick={() => setTasks(prev => prev.map(t => t.id===task.id ? {...t,is_done:!t.is_done} : t))}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${task.is_done ? "bg-emerald-500 border-emerald-500" : "border-[var(--border)] hover:border-emerald-500"}`}>
                    {task.is_done && <Check size={12} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm ${task.is_done ? "line-through text-[var(--text-secondary)]" : "text-[var(--text-main)]"}`}>{task.title}</div>
                    {task.notes && <div className="text-xs text-[var(--text-secondary)] mt-0.5">{task.notes}</div>}
                    {taskLeads.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {taskLeads.map(l => (
                          <button key={l.id} onClick={() => { openChat(l.id); setPage("chat"); }}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 text-xs hover:bg-indigo-500/20 transition-colors border border-indigo-500/20">
                            <MessageCircle size={10} />
                            {l.full_name || l.tg_username}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <div className={`flex items-center gap-1.5 text-xs font-mono font-bold ${overdue && !task.is_done ? "text-red-400 animate-pulse" : task.is_done ? "text-emerald-400" : "text-[var(--text-secondary)]"}`}>
                        <Clock size={11} />
                        {task.is_done ? "Выполнено" : overdue ? `⏰ ${timerText}` : timerText}
                      </div>
                      <span className="text-xs text-[var(--text-secondary)]">{fmtDate(task.due_at)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setTaskDraft({...task}); setEditTaskId(task.id); setTaskModal(true); }}
                      className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-indigo-400 transition-colors">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => { if(confirm("Удалить?")) setTasks(prev=>prev.filter(t=>t.id!==task.id)); }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {taskModal && (
          <Modal title={editTaskId ? "Редактировать задачу" : "Новая задача"} onClose={() => setTaskModal(false)}>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Название</label>
                <Input value={taskDraft.title||""} onChange={v => setTaskDraft(p=>({...p,title:v}))} placeholder="Что нужно сделать?" />
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Дата и время</label>
                <input type="datetime-local" value={taskDraft.due_at ? new Date(taskDraft.due_at).toISOString().slice(0,16) : ""}
                  onChange={e => setTaskDraft(p=>({...p,due_at:new Date(e.target.value).toISOString()}))}
                  className="input-base" />
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Привязать лидов</label>
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] pointer-events-none" />
                  <input value={taskLeadSearch} onChange={e => setTaskLeadSearch(e.target.value)} placeholder="Поиск лидов..."
                    className="input-base input-with-icon text-xs py-2" />
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {leads.filter(l => !taskLeadSearch || l.full_name.toLowerCase().includes(taskLeadSearch.toLowerCase()) || l.tg_username.toLowerCase().includes(taskLeadSearch.toLowerCase())).slice(0,20).map(l => (
                    <label key={l.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-elevated)] cursor-pointer">
                      <input type="checkbox" checked={taskDraft.lead_ids?.includes(l.id)||false}
                        onChange={e => setTaskDraft(p=>({...p,lead_ids:e.target.checked?[...(p.lead_ids||[]),l.id]:(p.lead_ids||[]).filter(x=>x!==l.id)}))}
                        className="accent-indigo-500" />
                      <Avatar name={l.full_name||l.tg_username} id={l.id} size={22} />
                      <span className="text-xs text-[var(--text-main)] truncate">{l.full_name||l.tg_username}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] mb-1.5 block font-medium">Заметки</label>
                <Input value={taskDraft.notes||""} onChange={v => setTaskDraft(p=>({...p,notes:v}))} rows={2} placeholder="Дополнительная информация..." />
              </div>
              <div className="flex gap-3 pt-2">
                <Btn onClick={() => {
                  if (!taskDraft.title) return;
                  if (editTaskId) setTasks(prev=>prev.map(t=>t.id===editTaskId?{...t,...taskDraft as Task}:t));
                  else setTasks(prev=>[...prev,{...taskDraft as Task,id:Date.now(),created_at:new Date().toISOString()}]);
                  setTaskModal(false); showToast("✅ Задача сохранена");
                }} className="flex-1 justify-center"><Check size={14} /> Сохранить</Btn>
                <Btn variant="secondary" onClick={() => setTaskModal(false)}>Отмена</Btn>
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER: STATS
  // ════════════════════════════════════════════════════════════════
  const renderStats = () => {
    const { from, to } = getStatsDateRange();
    const paid = filteredStatsLeads.filter(l => l.is_paid).length;
    const revenue = filteredStatsLeads.filter(l => l.is_paid).reduce((s, l) => s + (offers.find(o => o.id===l.offer_id)?.reward_amount||0), 0);
    const totalForConversion = filteredStatsLeads.length || 1;
    const conversion = Math.round((paid / totalForConversion) * 100) || 0;
    const holdAmount = balanceHistory.filter(r => r.type==="hold").reduce((s,r)=>s+r.amount,0);

    const todayStr = new Date().toISOString().split("T")[0];
    const writtenToday = Object.values(lastMsgMap).filter(m => m.direction==="incoming" && m.sent_at.startsWith(todayStr)).length;

    // Build daily chart data
    const days: string[] = [];
    const d = new Date(from);
    const toDate = new Date(to);
    while (d <= toDate) { days.push(d.toISOString().split("T")[0]); d.setDate(d.getDate()+1); }
    const chartDays = days.slice(-30);

    const chartData = chartDays.map(day => ({
      day,
      new: leads.filter(l => l.created_at.startsWith(day) && (statsAccount==="all" || l.tg_account_phone===statsAccount)).length,
      paid: leads.filter(l => l.is_paid && l.paid_date===day && (statsAccount==="all" || l.tg_account_phone===statsAccount)).length,
      msgs: Object.values(lastMsgMap).filter(m => m.sent_at.startsWith(day)).length,
      hold: balanceHistory.filter(b => b.type === "hold" && b.created_at.startsWith(day)).reduce((s,b) => s + Math.abs(b.amount), 0),
    }));
    const maxVal = Math.max(...chartData.map(d => Math.max(d.new, d.paid)), 1);

    const ranges = [
      { id: "today", label: "Сегодня" },
      { id: "yesterday", label: "Вчера" },
      { id: "week", label: "7 дней" },
      { id: "month", label: "30 дней" },
      { id: "all", label: "Всё" },
    ] as const;

    return (
      <div className="animate-fadeUp space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-main)]">Статистика</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">{from} — {to}</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 items-center">
            <div className="flex bg-[var(--bg-elevated)] rounded-xl p-1 border border-[var(--border)]">
              {ranges.map(r => (
                <button key={r.id} onClick={() => setStatsRange(r.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${statsRange===r.id ? "bg-indigo-600 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-main)]"}`}>
                  {r.label}
                </button>
              ))}
            </div>
            {statsRange === "all" && (
              <div className="flex gap-2">
                <Input type="date" value={statsDateFrom} onChange={v => setStatsDateFrom(v)} className="text-xs py-1.5 w-36" />
                <Input type="date" value={statsDateTo} onChange={v => setStatsDateTo(v)} className="text-xs py-1.5 w-36" />
              </div>
            )}
            <Select value={statsAccount} onChange={v => setStatsAccount(v)} className="text-xs py-1.5 w-44">
              <option value="all">Все аккаунты</option>
              {realTgAccounts.map(a => <option key={a.phone} value={a.phone}>{a.label}</option>)}
            </Select>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: "Новых лидов", value: filteredStatsLeads.length, icon: <UserPlus size={18} />, color: "#6366f1", sub: `за период` },
            { label: "Оплачено", value: paid, icon: <Check size={18} />, color: "#10b981", sub: `из ${filteredStatsLeads.length}` },
            { label: "Выручка", value: `${revenue.toLocaleString()}₽`, icon: <RussianRuble size={18} />, color: "#f59e0b", sub: "подтверждённая" },
            { label: "Конверсия", value: `${conversion}%`, icon: <TrendingUp size={18} />, color: "#8b5cf6", sub: "оплачено / всего" },
            { label: "В холде", value: `${holdAmount.toLocaleString()}₽`, icon: <Clock size={18} />, color: "#f97316", sub: "ожидает" },
            { label: "Написали сегодня", value: writtenToday, icon: <MessageCircle size={18} />, color: "#3b82f6", sub: "входящих сообщений" },
          ].map(({ label, value, icon, color, sub }, i) => (
            <Card key={label} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[var(--text-secondary)] font-medium">{label}</span>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: color + "20", color }}>
                  {icon}
                </div>
              </div>
              <div className="text-xl font-bold text-[var(--text-main)]">{value}</div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5">{sub}</div>
            </Card>
          ))}
        </div>

        {/* Chart */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="font-semibold text-[var(--text-main)]">Динамика по дням</h3>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><div className="w-3 h-3 rounded-sm bg-indigo-500" />Новые лиды</div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><div className="w-3 h-3 rounded-sm bg-emerald-500" />Оплачено</div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><div className="w-3 h-3 rounded-sm bg-blue-400" />Сообщений</div>
              </div>
            </div>
          </div>
          <div className="relative">
            <div className="flex items-end gap-1 h-40 overflow-x-auto scrollbar-hide pb-6">
              {chartData.map((d, i) => {
                const maxValWithMsgs = Math.max(...chartData.map(d => Math.max(d.new, d.paid, d.msgs)), 1);
                const newH = Math.max((d.new / maxValWithMsgs) * 100, d.new > 0 ? 6 : 2);
                const paidH = Math.max((d.paid / maxValWithMsgs) * 100, d.paid > 0 ? 6 : 2);
                const msgsH = Math.max((d.msgs / maxValWithMsgs) * 100, d.msgs > 0 ? 6 : 2);
                const dateLabel = new Date(d.day).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
                return (
                  <div key={d.day} className="flex flex-col items-center gap-0.5 group/bar flex-shrink-0 relative rounded-lg transition-colors hover:bg-white/5 cursor-default pb-1 px-0.5"
                    style={{ minWidth: chartData.length > 15 ? 22 : 36 }}
                    onMouseMove={e => { setStatsTooltip({ x: e.clientX, y: e.clientY, data: { date: dateLabel, new: d.new, paid: d.paid, msgs: d.msgs, hold: d.hold } }); }}
                    onMouseLeave={() => setStatsTooltip(null)}>
                    <div className="relative flex items-end gap-0.5 h-32">
                      <div className="rounded-t-md bg-indigo-500 transition-all duration-200 group-hover/bar:bg-indigo-400 w-2"
                        style={{ height: `${newH}%`, opacity: d.new === 0 ? 0.15 : 1 }} />
                      <div className="rounded-t-md bg-emerald-500 transition-all duration-200 group-hover/bar:bg-emerald-400 w-2"
                        style={{ height: `${paidH}%`, opacity: d.paid === 0 ? 0.15 : 1 }} />
                      <div className="rounded-t-md bg-blue-400 transition-all duration-200 group-hover/bar:bg-blue-300 w-2"
                        style={{ height: `${msgsH}%`, opacity: d.msgs === 0 ? 0.15 : 1 }} />
                    </div>
                    <div className="text-[9px] text-[var(--text-secondary)] rotate-45 origin-left mt-1 whitespace-nowrap">{dateLabel}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Tooltip — центрирован, показывает все 3 метрики */}
        {statsTooltip && (
          <div className="fixed z-[9999] pointer-events-none bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl p-3 text-xs -translate-x-1/2"
            style={{ top: statsTooltip.y - 165, left: statsTooltip.x - 90, maxWidth: 210 }}>
            <div className="font-semibold text-[var(--text-main)] mb-2 text-center border-b border-[var(--border)] pb-1.5">{String(statsTooltip.data.date)}</div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-indigo-500 shrink-0" /><span className="text-[var(--text-secondary)]">Новых лидов:</span><span className="font-bold text-[var(--text-main)] ml-auto pl-3">{String(statsTooltip.data.new)}</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-emerald-500 shrink-0" /><span className="text-[var(--text-secondary)]">Оплачено:</span><span className="font-bold text-[var(--text-main)] ml-auto pl-3">{String(statsTooltip.data.paid)}</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-amber-400 shrink-0" /><span className="text-[var(--text-secondary)]">В холде:</span><span className="font-bold text-amber-400 ml-auto pl-3">{Number(statsTooltip.data.hold ?? 0).toLocaleString("ru-RU")} ₽</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-blue-400 shrink-0" /><span className="text-[var(--text-secondary)]">Сообщений:</span><span className="font-bold text-[var(--text-main)] ml-auto pl-3">{String(statsTooltip.data.msgs ?? 0)}</span></div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER: SETTINGS
  // ════════════════════════════════════════════════════════════════
  const renderSettings = () => {
    const tabs = [
      { id: "accounts", icon: <Phone size={15} />, label: "Аккаунты" },
      { id: "offers", icon: <Tag size={15} />, label: "Офферы" },
      { id: "partners", icon: <Link size={15} />, label: "Партнёрки" },
      { id: "team", icon: <Users size={15} />, label: "Команда" },
      { id: "replies", icon: <MessageCircle size={15} />, label: "Быстрые ответы" },
    ] as const;

    return (
      <div className="animate-fadeUp space-y-5">
        <h2 className="text-xl font-bold text-[var(--text-main)]">Настройки</h2>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--bg-elevated)] p-1 rounded-2xl border border-[var(--border)] overflow-x-auto scrollbar-hide">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setSettingsTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${settingsTab===t.id ? "bg-indigo-600 text-white shadow" : "text-[var(--text-secondary)] hover:text-[var(--text-main)]"}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Accounts tab */}
        {settingsTab === "accounts" && (
          <div className="space-y-4 animate-fadeUp">
            {/* API Keys */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                  <Hash size={16} className="text-yellow-400" />
                </div>
                <h3 className="font-semibold text-[var(--text-main)]">Telegram API Ключи</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">API ID</label>
                  <Input value={apiIdInput} onChange={setApiIdInput} placeholder="12345678" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">API Hash</label>
                  <Input value={apiHashInput} onChange={setApiHashInput} placeholder="abcdef..." type="password" />
                </div>
              </div>
              <Btn onClick={async () => {
                localStorage.setItem("crm_api_id", JSON.stringify(apiIdInput));
                localStorage.setItem("crm_api_hash", JSON.stringify(apiHashInput));
                const r = await api.updateApiKeys(apiIdInput, apiHashInput);
                showToast(r.error ? `❌ ${r.error}` : "✅ Ключи сохранены");
              }} size="sm"><Check size={14} /> Сохранить ключи</Btn>
              <div className="mt-3 p-3 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)]">
                <p className="text-xs text-[var(--text-secondary)]">
                  Получить ключи на <a href="https://my.telegram.org" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">my.telegram.org</a> → API development tools
                </p>
              </div>
            </Card>

            {/* Connect TG */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                  <Phone size={16} className="text-indigo-400" />
                </div>
                <h3 className="font-semibold text-[var(--text-main)]">Подключить аккаунт</h3>
              </div>
              {tgError && <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-2.5 text-sm mb-4"><AlertCircle size={14} />{tgError}</div>}
              {tgStep === 0 && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Номер телефона</label>
                      <Input value={tgPhone} onChange={setTgPhone} placeholder="+79001234567" />
                    </div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Название</label>
                      <Input value={tgLabel} onChange={setTgLabel} placeholder="Основной" />
                    </div>
                  </div>
                  <Btn onClick={async () => {
                    setTgLoading(true); setTgError("");
                    const r = await api.addAccount(tgPhone, tgLabel);
                    if (r.error) { setTgError(r.error); } else { setTgStep(1); showToast("📱 Код отправлен в Telegram"); }
                    setTgLoading(false);
                  }} disabled={tgLoading || !tgPhone}>
                    {tgLoading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                    Отправить код
                  </Btn>
                </div>
              )}
              {tgStep === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Код из Telegram</label>
                    <Input value={tgCode} onChange={setTgCode} placeholder="12345" />
                  </div>
                  <div className="flex gap-2">
                    <Btn onClick={async () => {
                      setTgLoading(true); setTgError("");
                      const r = await api.confirmAccount(tgPhone, tgCode);
                      if (r.error) {
                        if (r.need_2fa) setTgStep(2);
                        else setTgError(r.error);
                      } else {
                        showToast("✅ Аккаунт подключён!");
                        setTgStep(0); setTgPhone(""); setTgLabel(""); setTgCode("");
                        api.getAccounts().then(res => { if (res.accounts) setRealTgAccounts(res.accounts); });
                      }
                      setTgLoading(false);
                    }} disabled={tgLoading || !tgCode}>
                      {tgLoading ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                      Подтвердить
                    </Btn>
                    <Btn variant="ghost" onClick={() => { setTgStep(0); setTgError(""); }}><ChevronLeft size={14} /> Назад</Btn>
                  </div>
                </div>
              )}
              {tgStep === 2 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Пароль 2FA</label>
                    <Input value={tgPassword} onChange={setTgPassword} type="password" placeholder="••••••" />
                  </div>
                  <div className="flex gap-2">
                    <Btn onClick={async () => {
                      setTgLoading(true); setTgError("");
                      const r = await api.confirmAccount(tgPhone, tgCode, tgPassword);
                      if (r.error) setTgError(r.error);
                      else {
                        showToast("✅ Аккаунт подключён!");
                        setTgStep(0); setTgPhone(""); setTgLabel(""); setTgCode(""); setTgPassword("");
                        api.getAccounts().then(res => { if (res.accounts) setRealTgAccounts(res.accounts); });
                      }
                      setTgLoading(false);
                    }} disabled={tgLoading || !tgPassword}>
                      {tgLoading ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
                      Войти
                    </Btn>
                    <Btn variant="ghost" onClick={() => { setTgStep(0); setTgError(""); }}><ChevronLeft size={14} /> Назад</Btn>
                  </div>
                </div>
              )}
            </Card>

            {/* Connected accounts */}
            <Card className="p-5">
              <h3 className="font-semibold text-[var(--text-main)] mb-4">Подключённые аккаунты</h3>
              {realTgAccounts.length === 0 ? (
                <div className="text-center py-8">
                  <Phone size={28} className="mx-auto mb-3 text-[var(--text-muted)]" />
                  <p className="text-sm text-[var(--text-secondary)]">Нет подключённых аккаунтов</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {realTgAccounts.map(acc => {
                    const isDisabled = disabledTgPhones.includes(acc.phone);
                    return (
                      <div key={acc.phone} className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${isDisabled ? "border-red-500/20 bg-red-500/5 opacity-60" : "border-[var(--border)] bg-[var(--bg-elevated)]"}`}>
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: isDisabled ? "rgba(239,68,68,0.1)" : "rgba(99,102,241,0.1)" }}>
                          <Phone size={18} className={isDisabled ? "text-red-400" : "text-indigo-400"} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-[var(--text-main)]">{acc.label}</div>
                          <div className="text-xs text-[var(--text-secondary)]">{acc.phone} {acc.username ? `· @${acc.username}` : ""}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${isDisabled ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${isDisabled ? "bg-red-400" : "bg-emerald-400 animate-pulse"}`} />
                            {isDisabled ? "Отключён" : "Активен"}
                          </div>
                          {isAdmin && (
                            <button onClick={() => {
                              setDisabledTgPhones(prev => isDisabled ? prev.filter(p => p !== acc.phone) : [...prev, acc.phone]);
                              showToast(isDisabled ? `✅ ${acc.label} активирован` : `⛔ ${acc.label} деактивирован`);
                            }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${isDisabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20"}`}>
                              {isDisabled ? <><ToggleLeft size={14} /> Включить</> : <><ToggleRight size={14} /> Отключить</>}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Offers tab */}
        {settingsTab === "offers" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--text-main)]">Офферы</h3>
                <Btn size="sm" onClick={() => setShowNewOffer(v => !v)}><Plus size={14} /> Добавить</Btn>
              </div>

              {showNewOffer && (
                <div className="mb-4 p-4 bg-[var(--bg-elevated)] rounded-xl border border-indigo-500/30 animate-fadeUp space-y-3">
                  <h4 className="text-sm font-semibold text-[var(--text-main)]">Новый оффер</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs text-[var(--text-secondary)] mb-1 block">Название</label><Input value={newOfferName} onChange={setNewOfferName} placeholder="Альфа Black" /></div>
                    <div>
                      <label className="text-xs text-[var(--text-secondary)] mb-1 block">Тип</label>
                      <Select value={newOfferType} onChange={v => setNewOfferType(v as "lk"|"partner")}>
                        <option value="lk">ЛК</option>
                        <option value="partner">Партнёрка</option>
                      </Select>
                    </div>
                    {newOfferType === "partner" && (
                      <div>
                        <label className="text-xs text-[var(--text-secondary)] mb-1 block">Партнёрская сеть</label>
                        <Select value={newOfferPartner} onChange={v => setNewOfferPartner(v ? +v : "")}>
                          <option value="">— выбрать —</option>
                          {partnerNetworks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </Select>
                      </div>
                    )}
                    <div><label className="text-xs text-[var(--text-secondary)] mb-1 block">Вознаграждение ₽</label><Input value={newOfferAmount} onChange={setNewOfferAmount} placeholder="1500" /></div>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={() => {
                      if (!newOfferName) return;
                      const newO: Offer = { id: Date.now(), name: newOfferName, type: newOfferType, partner_network_id: newOfferType==="partner" ? (newOfferPartner||null) as number|null : null, reward_amount: +newOfferAmount||0, is_active: true, notes: "", sort_order: offers.length };
                      setOffers(prev => [...prev, newO]);
                      setNewOfferName(""); setNewOfferType("lk"); setNewOfferPartner(""); setNewOfferAmount("1500"); setShowNewOffer(false);
                      showToast(`✅ Оффер «${newO.name}» добавлен`);
                    }}><Check size={13} /> Добавить</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setShowNewOffer(false)}>Отмена</Btn>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {offers.map((offer, i) => {
                  const isDragging = dragIdx === i;
                  const isOver = dragOverIdx === i;
                  const pn = offer.type === "partner" ? partnerNetworks.find(p => p.id === offer.partner_network_id) : null;
                  return (
                    <div key={offer.id}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                      onDrop={() => {
                        if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
                        const arr = [...offers];
                        const [item] = arr.splice(dragIdx, 1);
                        arr.splice(i, 0, item);
                        setOffers(arr.map((o,idx) => ({...o,sort_order:idx})));
                        setDragIdx(null); setDragOverIdx(null);
                        showToast(`✅ «${item.name}» перемещён на позицию ${i+1}`);
                      }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                      onDragLeave={() => { if (dragOverIdx === i) setDragOverIdx(null); }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${isDragging ? "opacity-40 scale-[0.98] border-dashed border-[var(--border)]" : isOver ? "border-indigo-500 bg-indigo-500/5 scale-[1.01] shadow-lg shadow-indigo-900/20" : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-indigo-500/50"}`}>
                      {/* Drag handle */}
                      <div className="flex items-center gap-1 text-[var(--text-secondary)] cursor-grab shrink-0">
                        <GripVertical size={16} />
                        <span className="text-xs font-mono text-[var(--text-muted)] w-4 text-center">{i+1}</span>
                      </div>
                      {/* Name + type badge */}
                      <div className="flex-1 min-w-0">
                        <input value={offer.name} onChange={e => setOffers(prev => prev.map(o => o.id===offer.id ? {...o,name:e.target.value} : o))}
                          className="bg-transparent text-sm font-medium text-[var(--text-main)] outline-none w-full truncate" />
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${offer.type==="lk" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"}`}>
                          {offer.type === "lk" ? "ЛК" : pn?.name || "Партнёрка"}
                        </span>
                      </div>
                      {/* Reward input */}
                      <div className="flex items-center gap-1 shrink-0 border border-[var(--border)] rounded-lg px-2 py-1 bg-[var(--bg-main)]">
                        <input value={offer.reward_amount} type="number"
                          onChange={e => setOffers(prev => prev.map(o => o.id===offer.id ? {...o,reward_amount:+e.target.value} : o))}
                          className="w-16 text-xs text-right bg-transparent outline-none text-[var(--text-main)]" />
                        <span className="text-xs text-[var(--text-secondary)] shrink-0">₽</span>
                      </div>
                      {/* Delete */}
                      <button onClick={() => { if(confirm("Удалить?")) setOffers(prev=>prev.filter(o=>o.id!==offer.id)); }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400 transition-colors shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Cabinets */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--text-main)]">ЛК Кабинеты</h3>
                <div className="flex gap-2">
                  <button onClick={() => setShowArchivedCab(v=>!v)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-main)] flex items-center gap-1">
                    {showArchivedCab ? <EyeOff size={13} /> : <Eye size={13} />} Архив
                  </button>
                </div>
              </div>

              {/* Add cabinet */}
              <div className="mb-4 p-3 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border)] space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={newCabinetOfferId} onChange={v => setNewCabinetOfferId(v?+v:"")}>
                    <option value="">Выбрать оффер</option>
                    {offers.filter(o=>o.type==="lk").map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                  <Input value={newCabinetName} onChange={setNewCabinetName} placeholder="Название кабинета" />
                  <Input value={newCabinetLink} onChange={setNewCabinetLink} placeholder="Реф. ссылка" />
                  <Input value={newCabinetMax} onChange={setNewCabinetMax} placeholder="Лимит лидов" type="number" />
                </div>
                <Btn size="sm" onClick={() => {
                  if (!newCabinetOfferId || !newCabinetName) return;
                  setCabinets(prev => [...prev, { id: Date.now(), name: newCabinetName, offer_id: +newCabinetOfferId, referral_link: newCabinetLink, leads_count: 0, max_leads: +newCabinetMax||33, is_active: true, notes: "", is_archived: false }]);
                  setNewCabinetName(""); setNewCabinetLink(""); setNewCabinetMax("33"); setNewCabinetOfferId("");
                  showToast("✅ Кабинет добавлен");
                }}><Plus size={13} /> Добавить кабинет</Btn>
              </div>

              <div className="space-y-2">
                {cabinets.filter(c => showArchivedCab ? c.is_archived : !c.is_archived).map(cab => {
                  const offer = offers.find(o => o.id === cab.offer_id);
                  const pct = Math.min((cab.leads_count / cab.max_leads) * 100, 100);
                  const isFull = cab.leads_count >= cab.max_leads;
                  return (
                    <div key={cab.id} className={`p-4 rounded-xl border ${cab.is_archived ? "border-[var(--border)] opacity-50" : isFull ? "border-red-500/30 bg-red-500/5" : "border-[var(--border)] bg-[var(--bg-elevated)]"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="text-sm font-medium text-[var(--text-main)]">{cab.name}</div>
                          <div className="text-xs text-[var(--text-secondary)]">{offer?.name || "—"}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${isFull ? "text-red-400" : "text-[var(--text-secondary)]"}`}>{cab.leads_count}/{cab.max_leads}</span>
                          <button onClick={() => { if(confirm("Сбросить статистику?")) setCabinets(prev=>prev.map(c=>c.id===cab.id?{...c,leads_count:0}:c)); showToast("✅ Стата сброшена"); }}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-main)] text-[var(--text-secondary)] text-xs" title="Сбросить"><RefreshCw size={13} /></button>
                          <button onClick={() => { setCabinets(prev=>prev.map(c=>c.id===cab.id?{...c,is_archived:!c.is_archived}:c)); showToast(cab.is_archived?"✅ Разархивирован":"📁 Заархивирован"); }}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-main)] text-[var(--text-secondary)] text-xs"><Archive size={13} /></button>
                          <button onClick={() => { if(confirm("Удалить?")) setCabinets(prev=>prev.filter(c=>c.id!==cab.id)); }}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-main)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: isFull ? "#ef4444" : pct > 80 ? "#f59e0b" : "#6366f1" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}

        {/* Partners tab */}
        {settingsTab === "partners" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--text-main)]">Партнёрские сети</h3>
                <Btn size="sm" onClick={() => setShowNewPartner(v=>!v)}><Plus size={14} /> Добавить</Btn>
              </div>
              {showNewPartner && (
                <div className="mb-4 p-4 bg-[var(--bg-elevated)] rounded-xl border border-indigo-500/30 space-y-3 animate-fadeUp">
                  <div className="grid grid-cols-3 gap-2">
                    <Input value={newPartnerName} onChange={setNewPartnerName} placeholder="Название" />
                    <Input value={newPartnerUrl} onChange={setNewPartnerUrl} placeholder="URL" />
                    <Input value={newPartnerNotes} onChange={setNewPartnerNotes} placeholder="Заметки" />
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={() => {
                      if (!newPartnerName) return;
                      setPartnerNetworks(prev=>[...prev,{id:Date.now(),name:newPartnerName,url:newPartnerUrl,notes:newPartnerNotes}]);
                      setNewPartnerName(""); setNewPartnerUrl(""); setNewPartnerNotes(""); setShowNewPartner(false);
                      showToast("✅ Добавлено");
                    }}><Check size={13} /> Добавить</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setShowNewPartner(false)}>Отмена</Btn>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {partnerNetworks.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
                    <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Link size={14} className="text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
                      <input value={p.name} onChange={e=>setPartnerNetworks(prev=>prev.map(x=>x.id===p.id?{...x,name:e.target.value}:x))} className="input-base text-sm py-1.5" />
                      <input value={p.url} onChange={e=>setPartnerNetworks(prev=>prev.map(x=>x.id===p.id?{...x,url:e.target.value}:x))} className="input-base text-sm py-1.5" />
                      <input value={p.notes} onChange={e=>setPartnerNetworks(prev=>prev.map(x=>x.id===p.id?{...x,notes:e.target.value}:x))} className="input-base text-sm py-1.5" placeholder="Заметки" />
                    </div>
                    <button onClick={()=>{if(confirm("Удалить?"))setPartnerNetworks(prev=>prev.filter(x=>x.id!==p.id));}} className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Team tab */}
        {settingsTab === "team" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--text-main)]">Команда</h3>
                {isAdmin && <Btn size="sm" onClick={() => setShowNewManager(v=>!v)}><UserPlus size={14} /> + Менеджер</Btn>}
              </div>
              {showNewManager && (
                <div className="mb-4 p-4 bg-[var(--bg-elevated)] rounded-xl border border-indigo-500/30 space-y-3 animate-fadeUp">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-xs text-[var(--text-secondary)] mb-1 block">Имя</label><Input value={newManagerName} onChange={setNewManagerName} placeholder="Имя менеджера" /></div>
                    <div><label className="text-xs text-[var(--text-secondary)] mb-1 block">Пароль</label><Input value={newManagerPass} onChange={setNewManagerPass} type="password" placeholder="Пароль" /></div>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={async () => {
                      if (!newManagerName || !newManagerPass) return;
                      const hash = await sha256(newManagerPass);
                      setUsers(prev=>[...prev,{id:Date.now(),name:newManagerName,role:"manager",password_hash:hash,account_ids:[],is_blocked:false,created_at:new Date().toISOString()}]);
                      setNewManagerName(""); setNewManagerPass(""); setShowNewManager(false); showToast("✅ Менеджер добавлен");
                    }}><Check size={13} /> Добавить</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setShowNewManager(false)}>Отмена</Btn>
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {users.map(u => (
                  <div key={u.id} className={`flex items-center gap-3 p-4 rounded-xl border ${u.is_blocked ? "border-red-500/20 opacity-60" : "border-[var(--border)] bg-[var(--bg-elevated)]"}`}>
                    <div style={{ width:40,height:40,borderRadius:"50%",background:avatarColor(u.id),display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700,flexShrink:0 }}>
                      {avatarText(u.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-[var(--text-main)]">{u.name}</div>
                      <div className="text-xs text-[var(--text-secondary)]">{u.role === "admin" ? "Администратор" : "Менеджер"}</div>
                    </div>
                    {isAdmin && u.name !== "admin" && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <select value={u.role} onChange={e => setUsers(prev=>prev.map(x=>x.id===u.id?{...x,role:e.target.value as "admin"|"manager"}:x))}
                            className="input-base text-xs py-1.5 w-28">
                            <option value="manager">Менеджер</option>
                            <option value="admin">Админ</option>
                          </select>
                          <button onClick={() => setUsers(prev=>prev.map(x=>x.id===u.id?{...x,is_blocked:!x.is_blocked}:x))}
                            className={`p-2 rounded-xl border transition-all ${u.is_blocked ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                            {u.is_blocked ? <Unlock size={14} /> : <Lock size={14} />}
                          </button>
                        </div>
                        {/* Привязка TG аккаунтов */}
                        <div className="p-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
                          <div className="text-[10px] text-[var(--text-secondary)] mb-1.5 font-medium uppercase tracking-wide">TG аккаунты</div>
                          <div className="flex flex-wrap gap-1.5">
                            {accounts.map(acc => {
                              const has = u.account_ids.includes(acc.id);
                              return (
                                <button key={acc.id} onClick={() => setUsers(prev=>prev.map(x=>x.id===u.id?{...x,account_ids:has?x.account_ids.filter(id=>id!==acc.id):[...x.account_ids,acc.id]}:x))}
                                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${has ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" : "border-[var(--border)] text-[var(--text-secondary)] hover:border-indigo-500/30"}`}>
                                  {has ? "✓ " : ""}{acc.label}
                                </button>
                              );
                            })}
                            {accounts.length === 0 && <span className="text-[10px] text-[var(--text-secondary)]">Нет аккаунтов</span>}
                          </div>
                        </div>
                        <button onClick={() => { if(confirm("Удалить?")) setUsers(prev=>prev.filter(x=>x.id!==u.id)); }}
                          className="p-2 rounded-xl hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400 border border-transparent hover:border-red-500/20 transition-all">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Quick replies tab */}
        {settingsTab === "replies" && (
          <div className="space-y-4 animate-fadeUp">
            <Card className="p-5">
              <h3 className="font-semibold text-[var(--text-main)] mb-4">Быстрые ответы</h3>
              <div className="space-y-2 mb-4">
                {quickReplies.map(r => (
                  <div key={r.id} className="border border-[var(--border)] rounded-xl p-3 bg-[var(--bg-elevated)]">
                    {editReplyId === r.id ? (
                      <div className="space-y-2">
                        <input value={editReplyDraft.shortcut} onChange={e=>setEditReplyDraft(p=>({...p,shortcut:e.target.value}))} placeholder="ярлык" className="input-base text-sm py-2" />
                        <textarea value={editReplyDraft.text} onChange={e=>setEditReplyDraft(p=>({...p,text:e.target.value}))} rows={2} className="input-base text-sm resize-none" />
                        <div className="flex gap-2">
                          <Btn size="sm" onClick={()=>{setQuickReplies(prev=>prev.map(x=>x.id===r.id?{...x,...editReplyDraft}:x));setEditReplyId(null);showToast("✅ Сохранено");}}><Check size={12} /> Сохранить</Btn>
                          <Btn size="sm" variant="ghost" onClick={()=>setEditReplyId(null)}>Отмена</Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-lg">/{r.shortcut}</span>
                            <label className="flex items-center gap-1 cursor-pointer ml-auto">
                              <input type="checkbox" checked={r.is_active} onChange={e=>setQuickReplies(prev=>prev.map(x=>x.id===r.id?{...x,is_active:e.target.checked}:x))} className="accent-indigo-500" />
                              <span className="text-xs text-[var(--text-secondary)]">активен</span>
                            </label>
                          </div>
                          <div className="text-sm text-[var(--text-secondary)] truncate">{r.text}</div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={()=>{setEditReplyId(r.id);setEditReplyDraft({shortcut:r.shortcut,text:r.text});}} className="p-1.5 rounded-lg hover:bg-[var(--bg-main)] text-[var(--text-secondary)] hover:text-indigo-400"><Edit2 size={13} /></button>
                          <button onClick={()=>{if(confirm("Удалить?"))setQuickReplies(prev=>prev.filter(x=>x.id!==r.id));}} className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-[var(--border)] pt-4 space-y-3">
                <h4 className="text-sm font-medium text-[var(--text-main)]">+ Новый ответ</h4>
                <Input value={newReplyShortcut} onChange={setNewReplyShortcut} placeholder="/ярлык" />
                <Input value={newReplyText} onChange={setNewReplyText} rows={2} placeholder="Текст ответа..." />
                <Btn size="sm" onClick={() => {
                  if (!newReplyShortcut || !newReplyText) return;
                  setQuickReplies(prev=>[...prev,{id:Date.now(),shortcut:newReplyShortcut.replace("/",""),text:newReplyText,is_active:true}]);
                  setNewReplyShortcut(""); setNewReplyText(""); showToast("✅ Добавлен");
                }}><Plus size={13} /> Добавить</Btn>
              </div>
            </Card>
          </div>
        )}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen overflow-hidden antialiased text-[15px]" style={{ background: "var(--bg-main)" }}>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col transition-all duration-300 shrink-0 border-r border-[var(--border)] overflow-hidden"
        style={{ width: sidebarOpen ? 224 : 0, minWidth: sidebarOpen ? 224 : 0, overflow: "hidden", overflowX: "hidden", background: "var(--bg-sidebar)" }}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 4px 12px rgba(99,102,241,0.4)" }}>
            <span className="text-base">💳</span>
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-[var(--text-main)] whitespace-nowrap">TG Card CRM</div>
            <div className="text-[10px] text-[var(--text-secondary)] whitespace-nowrap">v2.0 premium</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {navItems.map(item => {
            const isActive = page === item.id;
            return (
              <button key={item.id} onClick={() => { setPage(item.id as typeof page); if (item.id === "chat") setChatVisibleCount(50); }}
                className={`w-[calc(100%-22px)] mx-2 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative overflow-hidden ${isActive ? "nav-active" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"}`}>
                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-500 rounded-r-full" />}
                <span className={`shrink-0 ${isActive ? "text-indigo-400" : ""}`}>{item.icon}</span>
                <span className="truncate flex-1 text-left">{item.label}</span>
                {"badge" in item && (item.badge as number) > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">{item.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-[var(--border)]">
          <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--bg-elevated)] mb-2">
            <div style={{ width:32, height:32, borderRadius:"50%", background:avatarColor(currentUser.id), display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11, fontWeight:700, flexShrink:0 }}>
              {avatarText(currentUser.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-[var(--text-main)] truncate">{currentUser.name}</div>
              <div className="text-[10px] text-[var(--text-secondary)]">{currentUser.role === "admin" ? "Администратор" : "Менеджер"}</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-2 py-2 px-3 text-xs rounded-xl text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-all">
            <LogOut size={13} /> Выйти
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] shrink-0" style={{ background: "var(--bg-card)" }}>
          <button onClick={() => setSidebarOpen(v => !v)}
            className="hidden md:flex w-8 h-8 items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors">
            {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-[var(--text-main)] text-base">{navItems.find(n => n.id === page)?.label}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification bell */}
            <div className="relative">
              <button onClick={() => { setNotifOpen(v => !v); if (notifOpen) setNotifShowAll(false); }}
                className="relative w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)] transition-colors">
                <Bell size={18} />
                {unreadNotifs > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center animate-popIn">{unreadNotifs > 9 ? "9+" : unreadNotifs}</span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 z-[100] bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl w-80 max-h-[480px] overflow-y-auto animate-scaleIn">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-card)] z-10">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-[var(--text-main)]">Уведомления</span>
                      {unreadNotifs > 0 && <span className="bg-red-500/10 text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">{unreadNotifs}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setNotifShowAll(v => !v)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${notifShowAll ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : "border-[var(--border)] text-[var(--text-secondary)]"}`}>
                        {notifShowAll ? "Все" : "Новые"}
                      </button>
                      {unreadNotifs > 0 && <button onClick={markAllRead} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"><Check size={13} /></button>}
                      <button onClick={() => setNotifOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-main)] w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[var(--bg-elevated)]"><X size={14} /></button>
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="text-center py-10"><Bell size={28} className="mx-auto mb-3 text-[var(--text-muted)]" /><p className="text-sm text-[var(--text-secondary)]">Нет уведомлений</p></div>
                  ) : (
                    <div className="divide-y divide-[var(--border)]">
                      {notifications.filter(n => notifShowAll ? true : !n.is_read).map(n => (
                        <div key={n.id} onClick={() => { markNotifRead(n.id); if (n.lead_id) { openChat(n.lead_id); setPage("chat"); setNotifOpen(false); } }}
                          className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--bg-elevated)] transition-colors ${n.is_read ? "opacity-50" : ""}`}>
                          <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${n.is_read ? "bg-[var(--border)]" : "bg-indigo-500 animate-pulse"}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-[var(--text-main)] leading-snug">{n.text}</div>
                            <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                              {n.is_read ? <span className="text-emerald-400 flex items-center gap-1"><Check size={10} /> прочитано</span> : <span className="text-indigo-400">● новое</span>}
                              {" · "}{fmtDate(n.created_at)}
                            </div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); removeNotif(n.id); }} className="text-[var(--text-secondary)] hover:text-red-400 w-5 h-5 flex items-center justify-center rounded-lg hover:bg-red-500/10 shrink-0"><X size={12} /></button>
                        </div>
                      ))}
                      {!notifShowAll && unreadNotifs === 0 && (
                        <div className="text-center py-5 text-sm text-[var(--text-secondary)]">
                          Все прочитаны
                          <button onClick={() => setNotifShowAll(true)} className="block mx-auto mt-1 text-xs text-indigo-400 hover:text-indigo-300">Показать все →</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme toggle */}
            <button onClick={() => setDark(v => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)] transition-colors">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className={`flex-1 overflow-y-auto ${page === "chat" ? "" : "p-4 md:p-6"}`}>
          {page === "leads" && renderLeads()}
          {page === "chat" && renderChat()}
          {page === "balance" && renderBalance()}
          {page === "tasks" && renderTasks()}
          {page === "stats" && renderStats()}
          {page === "settings" && renderSettings()}
        </main>

        {/* Mobile nav */}
        <nav className="md:hidden flex border-t border-[var(--border)] shrink-0" style={{ background: "var(--bg-card)" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setPage(item.id as typeof page); if (item.id === "chat") setChatVisibleCount(50); }}
              className={`flex-1 flex flex-col items-center py-2.5 text-[10px] transition-colors relative ${page === item.id ? "text-indigo-400" : "text-[var(--text-secondary)]"}`}>
              <span className={`mb-0.5 ${page === item.id ? "text-indigo-400" : ""}`}>{item.icon}</span>
              <span>{item.label}</span>
              {"badge" in item && (item.badge as number) > 0 && (
                <span className="absolute top-1.5 right-1/4 bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Modals */}
      {leadModal && (
        <LeadModalForm
          lead={leadModal}
          isNew={leadModalNew}
          offers={offers}
          cabinets={cabinets}
          partnerNetworks={partnerNetworks}
          realTgAccounts={realTgAccounts}
          isAdmin={isAdmin}
          onSave={lead => {
            if (leadModalNew) {
              setLeads(prev => [...prev, { ...lead, id: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
              showToast("✅ Лид добавлен");
            } else {
              setLeads(prev => prev.map(l => l.id === lead.id ? { ...lead, updated_at: new Date().toISOString() } : l));
              showToast("✅ Сохранено");
            }
            setLeadModal(null);
          }}
          onDelete={id => {
            if (!confirm("Удалить лида?")) return;
            setLeads(prev => prev.filter(l => l.id !== id));
            setLeadModal(null);
            showToast("🗑 Удалён");
          }}
          onClose={() => setLeadModal(null)}
        />
      )}
      {chatProfileOpen && renderChatProfile()}

      {/* Status dropdown */}
      {statusDropdown && (
        <StatusDropdown
          current={statusDropdown.lead.status}
          anchorEl={statusDropdown.el}
          onChange={s => {
            handleStatusChange(statusDropdown.lead, s);
            setStatusDropdown(null);
          }}
          onClose={() => setStatusDropdown(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast text={toast} onClose={() => setToast(null)} />}

      {/* Context menu */}
      {chatContextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setChatContextMenu(null)} />
          <div style={{ position: "fixed", top: chatContextMenu.y, left: chatContextMenu.x, zIndex: 99999 }}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl py-1.5 w-52 animate-scaleIn">
            {(() => {
              const lead = leads.find(l => l.id === chatContextMenu.leadId);
              if (!lead) return null;
              const isMutedLead = mutedLeads.includes(lead.id);
              const isArchivedLead = archivedChats.includes(lead.id);
              return (
                <>
                  <div className="px-4 py-2 border-b border-[var(--border)] mb-1">
                    <div className="font-semibold text-sm text-[var(--text-main)] truncate">{lead.full_name}</div>
                    <div className="text-xs text-[var(--text-secondary)]">@{lead.tg_username}</div>
                  </div>
                  {[
                    { icon: isMutedLead ? <Volume2 size={14} /> : <VolumeX size={14} />, label: isMutedLead ? "Включить уведомления" : "Отключить уведомления", onClick: () => { toggleMute(lead.id); setChatContextMenu(null); } },
                    { icon: isArchivedLead ? <FolderOpen size={14} /> : <Archive size={14} />, label: isArchivedLead ? "Вернуть из архива" : "Скрыть в архив", onClick: () => {
                      setChatContextMenu(null);
                      if (isArchivedLead) { if(confirm("Вернуть из архива?")) toggleArchive(lead.id, false); }
                      else { if(confirm(`Скрыть чат с «${lead.full_name}»?`)) toggleArchive(lead.id, true); }
                    }},
                    { icon: <MessageCircle size={14} />, label: "Открыть диалог", onClick: () => { openChat(lead.id); setChatContextMenu(null); }, className: "text-indigo-400" },
                  ].map(({ icon, label, onClick, className }) => (
                    <button key={label} onClick={onClick} className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-[var(--bg-elevated)] transition-colors text-left ${className || "text-[var(--text-main)]"}`}>
                      <span className="text-[var(--text-secondary)]">{icon}</span>{label}
                    </button>
                  ))}
                  {lead.tg_username && (
                    <a href={`https://t.me/${lead.tg_username}`} target="_blank" rel="noreferrer" onClick={() => setChatContextMenu(null)}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors">
                      <ExternalLink size={14} /> Открыть в Telegram
                    </a>
                  )}
                </>
              );
            })()}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
// Error Boundary — ловит runtime ошибки и показывает понятный экран вместо белого
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string|null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(e: Error) { console.error("CRM Error:", e); }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight:"100vh", background:"#0a0a0f", color:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16, padding:24, fontFamily:"Inter,sans-serif" }}>
        <div style={{ fontSize:48 }}>⚠️</div>
        <div style={{ fontSize:20, fontWeight:700 }}>Ошибка приложения</div>
        <div style={{ color:"#94a3b8", fontSize:14, maxWidth:400, textAlign:"center" }}>{this.state.error}</div>
        <button onClick={() => { localStorage.clear(); window.location.reload(); }}
          style={{ marginTop:8, padding:"10px 24px", background:"#6366f1", color:"#fff", border:"none", borderRadius:12, cursor:"pointer", fontSize:14 }}>
          Очистить данные и перезагрузить
        </button>
        <button onClick={() => window.location.reload()}
          style={{ padding:"10px 24px", background:"#1e1e2e", color:"#f1f5f9", border:"1px solid #333", borderRadius:12, cursor:"pointer", fontSize:14 }}>
          Просто перезагрузить
        </button>
      </div>
    );
    return this.props.children;
  }
}

export function App() {
  const [user, setUser] = useState<CrmUser|null>(() => {
    try {
      const s = localStorage.getItem("crm_session");
      if (!s) return null;
      const parsed = JSON.parse(s);
      // Проверяем что сессия валидная
      if (!parsed || !parsed.name || !parsed.role) {
        localStorage.removeItem("crm_session");
        return null;
      }
      return parsed;
    } catch {
      localStorage.removeItem("crm_session");
      return null;
    }
  });

  useEffect(() => {
    const users: CrmUser[] = JSON.parse(localStorage.getItem("crm_users")||"null") || initUsers;
    const hasAdmin = users.some(u => u.name === "admin");
    if (!hasAdmin) {
      users.unshift({ id:1, name:"admin", role:"admin", password_hash:DEFAULT_ADMIN_HASH, account_ids:[1,2], is_blocked:false, created_at:new Date().toISOString() });
      localStorage.setItem("crm_users", JSON.stringify(users));
    }
  }, []);

  if (!user) return (
    <ErrorBoundary>
      <LoginScreen onLogin={u => { localStorage.setItem("crm_session", JSON.stringify(u)); setUser(u); }} />
    </ErrorBoundary>
  );
  return (
    <ErrorBoundary>
      <MainApp currentUser={user} onLogout={() => { localStorage.removeItem("crm_session"); setUser(null); }} />
    </ErrorBoundary>
  );
}

export default App;
