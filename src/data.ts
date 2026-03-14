
export type LeadStatus =
  | "новый" | "самовывоз" | "доставка" | "сделано"
  | "оплачено" | "сделать_цд" | "холд" | "отказ";

export const ALL_STATUSES: LeadStatus[] = [
  "новый", "самовывоз", "доставка", "сделано",
  "оплачено", "сделать_цд", "холд", "отказ",
];

export const STATUS_CONFIG: Record<LeadStatus, { label: string; bg: string; color: string; dot: string }> = {
  новый:      { label: "Новый",       bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  самовывоз:  { label: "Самовывоз",   bg: "#ede9fe", color: "#7c3aed", dot: "#8b5cf6" },
  доставка:   { label: "Доставка",    bg: "#dbeafe", color: "#1d4ed8", dot: "#3b82f6" },
  сделано:    { label: "Сделано",     bg: "#dcfce7", color: "#15803d", dot: "#22c55e" },
  оплачено:   { label: "Оплачено",    bg: "#d1fae5", color: "#065f46", dot: "#10b981" },
  сделать_цд: { label: "Сделать ЦД",  bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  холд:       { label: "Холд",        bg: "#ffedd5", color: "#c2410c", dot: "#f97316" },
  отказ:      { label: "Отказ",       bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444" },
};

export interface TgAccount {
  id: number; label: string; phone: string;
  is_active: boolean; hold_balance: number;
  total_earned: number; leads_count: number;
}

export interface PartnerNetwork {
  id: number; name: string; url: string; notes: string;
}

export interface Offer {
  id: number; name: string; type: "lk" | "partner";
  partner_network_id: number | null; reward_amount: number;
  is_active: boolean; notes: string; sort_order: number;
}

export interface LkCabinet {
  id: number; name: string; offer_id: number;
  referral_link: string; leads_count: number;
  max_leads: number; is_active: boolean; notes: string;
  is_archived: boolean;
}

export interface Lead {
  id: number; tg_user_id: string; tg_username: string;
  full_name: string; phone: string; source: string;
  tg_account_id: number; tg_account_phone: string; offer_id: number; cabinet_id: number | null;
  status: LeadStatus; delivery_date: string; delivery_address: string;
  is_paid: boolean; paid_date: string; reward_paid: number;
  in_tg_folder: boolean; chat_deleted: boolean; deleted_by: string;
  notes: string; created_at: string; updated_at: string;
}

export interface ChatMessage {
  id: number; lead_id: number; tg_account_id: number;
  direction: "incoming" | "outgoing"; text: string; sent_at: string;
  media_url?: string; media_type?: "photo" | "video" | "document" | "sticker" | "geo" | "contact" | "";
}

export interface Task {
  id: number; title: string; lead_ids: number[];
  recipients_count: number; due_at: string; is_done: boolean;
  tg_account_id: number; notes: string; created_at: string;
}

export interface BalanceRecord {
  id: number; tg_account_id: number; amount: number;
  type: "hold" | "earned" | "withdrawal";
  offer_id: number | null; lead_id: number | null;
  description: string; created_at: string;
}

export interface QuickReply {
  id: number; shortcut: string; text: string; is_active: boolean;
}

export interface Notification {
  id: number; text: string; is_read: boolean;
  created_at: string; type: "delivery" | "message" | "system";
  lead_id?: number;
}

export interface CrmUser {
  id: number; name: string; role: "admin" | "manager";
  password_hash: string; account_ids: number[];
  is_blocked: boolean; created_at: string;
}

export interface ChatFolder {
  id: number; name: string; lead_ids: number[];
}

const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().split("T")[0];
const in3days = new Date(); in3days.setDate(in3days.getDate() + 3);
const in3daysStr = in3days.toISOString().split("T")[0];

export const initTgAccounts: TgAccount[] = [];

export const initPartnerNetworks: PartnerNetwork[] = [
  { id: 1, name: "rafinad",   url: "https://rafinad.io",   notes: "Тбанк" },
  { id: 2, name: "lead.su",   url: "https://lead.su",      notes: "Газпром" },
  { id: 3, name: "myleadgid", url: "https://myleadgid.ru", notes: "ВТБ" },
];

export const initOffers: Offer[] = [
  { id: 1, name: "Альфа Black", type: "lk",     partner_network_id: null, reward_amount: 1800, is_active: true, notes: "", sort_order: 0 },
  { id: 2, name: "Тбанк",       type: "partner", partner_network_id: 1,    reward_amount: 1500, is_active: true, notes: "", sort_order: 1 },
  { id: 3, name: "Газпром",     type: "partner", partner_network_id: 2,    reward_amount: 1200, is_active: true, notes: "", sort_order: 2 },
  { id: 4, name: "ВТБ",         type: "partner", partner_network_id: 3,    reward_amount: 1300, is_active: true, notes: "", sort_order: 3 },
  { id: 5, name: "Озон",        type: "lk",      partner_network_id: null, reward_amount: 1600, is_active: true, notes: "", sort_order: 4 },
];

export const initCabinets: LkCabinet[] = [
  { id: 1, name: "ЛК Альфа #1", offer_id: 1, referral_link: "https://alfa.ru/ref1", leads_count: 28, max_leads: 33, is_active: true, notes: "", is_archived: false },
  { id: 2, name: "ЛК Альфа #2", offer_id: 1, referral_link: "https://alfa.ru/ref2", leads_count: 18, max_leads: 33, is_active: true, notes: "", is_archived: false },
  { id: 3, name: "ЛК Озон #1",  offer_id: 5, referral_link: "https://ozon.ru/ref1", leads_count: 12, max_leads: 33, is_active: true, notes: "", is_archived: false },
];

export const initLeads: Lead[] = [];

export const initTasks: Task[] = [];

export const initBalanceHistory: BalanceRecord[] = [];

export const initQuickReplies: QuickReply[] = [
  { id: 1, shortcut: "привет",   text: "Привет! 👋 Расскажу подробнее о карте — что вас интересует?",           is_active: true },
  { id: 2, shortcut: "доставка", text: "Доставка бесплатная, курьером на дом, 1–3 рабочих дня 🚚",             is_active: true },
  { id: 3, shortcut: "условия",  text: "Карта бесплатная: 0₽ обслуживание, кэшбэк до 33%, нужен только паспорт 💳", is_active: true },
  { id: 4, shortcut: "завтра",   text: "Завтра к вам приедет курьер с картой! Пожалуйста, будьте дома с 10 до 18 📦", is_active: true },
  { id: 5, shortcut: "готово",   text: "Отлично, карта оформлена! Ожидайте звонка от курьера ✅",               is_active: true },
  { id: 6, shortcut: "цд",       text: "Нужно сделать цифровую доставку — пришлите скан паспорта 📋",           is_active: true },
  { id: 7, shortcut: "отказ",    text: "Хорошо, понял! Если передумаете — обращайтесь 😊",                     is_active: true },
  { id: 8, shortcut: "статус",   text: "Карта уже в пути! Трекинг отправлю чуть позже 📍",                     is_active: true },
];

export const initChatMessages: ChatMessage[] = [];

export const DEFAULT_ADMIN_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

export const initUsers: CrmUser[] = [
  { id: 1, name: "admin", role: "admin", password_hash: DEFAULT_ADMIN_HASH, account_ids: [1, 2], is_blocked: false, created_at: new Date().toISOString() },
];
