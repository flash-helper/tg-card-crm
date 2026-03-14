import asyncio
import json
import os
import glob
import sys
from datetime import datetime

# Windows fix
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from telethon import TelegramClient, events
from telethon.tl.types import User, Channel, Chat
from telethon.errors import (
    SessionPasswordNeededError,
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    FloodWaitError,
    ApiIdInvalidError,
    PhoneNumberInvalidError,
)
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

KEYS_FILE    = os.path.join(os.path.dirname(__file__), "keys.json")
SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
AVATARS_DIR  = os.path.join(os.path.dirname(__file__), "avatars")
MEDIA_DIR    = os.path.join(os.path.dirname(__file__), "media")

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(AVATARS_DIR,  exist_ok=True)
os.makedirs(MEDIA_DIR,    exist_ok=True)

# ── Ключи ─────────────────────────────────────────────────────────────────────

def load_keys():
    if os.path.exists(KEYS_FILE):
        try:
            with open(KEYS_FILE) as f:
                d = json.load(f)
            api_id   = int(d.get("api_id", 0))
            api_hash = str(d.get("api_hash", "")).strip()
            if api_id and api_hash:
                return api_id, api_hash
        except Exception as e:
            print(f"[KEYS] ошибка: {e}")
    return 0, ""

def save_keys(api_id: int, api_hash: str):
    with open(KEYS_FILE, "w") as f:
        json.dump({"api_id": api_id, "api_hash": api_hash}, f)

API_ID, API_HASH = load_keys()

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

try:
    app.mount("/avatars", StaticFiles(directory=AVATARS_DIR), name="avatars")
except Exception:
    pass
try:
    app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
except Exception:
    pass

# ── Состояние ─────────────────────────────────────────────────────────────────

clients: dict     = {}   # phone -> {client, label, me}
phone_codes: dict = {}   # phone -> {client, label, hash}
ws_clients: list  = []

# ── WebSocket ─────────────────────────────────────────────────────────────────

async def broadcast(data: dict):
    text = json.dumps(data, ensure_ascii=False)
    dead = []
    for ws in ws_clients:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in ws_clients:
            ws_clients.remove(ws)

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    ws_clients.append(ws)
    print(f"[WS] подключён клиент, всего: {len(ws_clients)}")
    try:
        while True:
            await asyncio.sleep(20)
            await ws.send_text('{"type":"ping"}')
    except Exception:
        pass
    finally:
        if ws in ws_clients:
            ws_clients.remove(ws)
        print(f"[WS] клиент отключился, всего: {len(ws_clients)}")

# ── Загрузка сессий при старте ────────────────────────────────────────────────

async def load_sessions():
    if not API_ID or not API_HASH:
        print("[SESSIONS] ⚠️  Ключи не заданы — аккаунты не загружены")
        return

    files = glob.glob(os.path.join(SESSIONS_DIR, "*.session"))
    print(f"[SESSIONS] найдено файлов: {len(files)}")

    for sf in files:
        base   = os.path.splitext(sf)[0]
        digits = os.path.basename(base)
        phone  = f"+{digits}" if not digits.startswith("+") else digits
        try:
            c = TelegramClient(base, API_ID, API_HASH)
            await c.connect()
            if not await c.is_user_authorized():
                await c.disconnect()
                continue
            me   = await c.get_me()
            name = f"{me.first_name or ''} {me.last_name or ''}".strip() or phone
            clients[phone] = {
                "client": c, "label": name,
                "me": {"id": me.id, "name": name,
                       "username": me.username or "", "phone": phone}
            }
            setup_handlers(c, phone)
            print(f"[SESSIONS] ✅ {phone} ({name})")
        except Exception as e:
            print(f"[SESSIONS] ❌ {phone}: {e}")

def setup_handlers(client: TelegramClient, phone: str):
    """Обработчик ТОЛЬКО личных входящих сообщений от живых людей"""
    @client.on(events.NewMessage(incoming=True))
    async def handler(event):
        try:
            # Игнорируем группы и каналы
            if event.is_group or event.is_channel:
                return

            sender = await event.get_sender()

            # Только живые пользователи (не боты, не каналы)
            if not isinstance(sender, User):
                return
            if sender.bot:
                return

            # Игнорируем системные аккаунты Telegram
            if sender.id in [777000, 42777, 93372553]:
                return

            text      = event.message.message or ""
            media_url = ""
            media_type = ""

            # Обрабатываем медиа (фото, видео, документы, стикеры)
            if event.message.media:
                try:
                    msg_id   = event.message.id
                    user_id  = sender.id
                    ext      = "jpg"
                    mtype    = type(event.message.media).__name__

                    if "Photo" in mtype:
                        ext        = "jpg"
                        media_type = "photo"
                    elif "Document" in mtype:
                        doc = event.message.media.document
                        for attr in doc.attributes:
                            if hasattr(attr, "file_name") and attr.file_name:
                                ext = attr.file_name.split(".")[-1].lower()
                                break
                        # Видео
                        if any("Video" in type(a).__name__ for a in doc.attributes):
                            media_type = "video"
                            if ext not in ["mp4","mov","avi","mkv"]: ext = "mp4"
                        elif any("Sticker" in type(a).__name__ for a in doc.attributes):
                            media_type = "sticker"
                            if ext not in ["webp","tgs"]: ext = "webp"
                        else:
                            media_type = "document"
                    elif "Geo" in mtype:
                        lat = event.message.media.geo.lat
                        lng = event.message.media.geo.long
                        text = text or f"📍 Геолокация: {lat}, {lng}"
                        media_type = "geo"
                    elif "Contact" in mtype:
                        c = event.message.media
                        text = text or f"👤 Контакт: {getattr(c, 'first_name', '')} {getattr(c, 'phone_number', '')}"
                        media_type = "contact"

                    if media_type in ["photo","video","document","sticker"]:
                        fname    = f"{user_id}_{msg_id}.{ext}"
                        fpath    = os.path.join(MEDIA_DIR, fname)
                        await client.download_media(event.message, file=fpath)
                        if os.path.exists(fpath) and os.path.getsize(fpath) > 0:
                            media_url = f"http://localhost:8000/media/{fname}"
                except Exception as me:
                    print(f"[MEDIA] ошибка загрузки: {me}")

            # Не пропускаем медиа без текста — отправляем с media_url
            if not text and not media_url:
                return

            await broadcast({
                "type":             "new_message",
                "phone":            phone,
                "tg_user_id":       str(sender.id),
                "username":         sender.username or "",
                "full_name":        f"{sender.first_name or ''} {sender.last_name or ''}".strip(),
                "text":             text,
                "media_url":        media_url,
                "media_type":       media_type,
                "direction":        "incoming",
                "sent_at":          datetime.now().isoformat(),
                "tg_account_phone": phone,
            })
            print(f"[MSG] {phone} ← {sender.username or sender.id}: {text[:40] or f'[{media_type}]'}")
        except Exception as e:
            print(f"[HANDLER] {e}")

# ── Pydantic ──────────────────────────────────────────────────────────────────

class AddAcc(BaseModel):     phone: str; label: str
class ConfirmAcc(BaseModel): phone: str; code: str; password: str = ""
class SendMsg(BaseModel):    phone: str; username: str; text: str
class ApiKeys(BaseModel):    api_id: str; api_hash: str

from fastapi import UploadFile, File, Form

# ── Хелперы ───────────────────────────────────────────────────────────────────

def norm(phone: str) -> str:
    """Нормализует номер телефона: убирает пробелы, дефисы, скобки"""
    for ch in [" ", "-", "(", ")", "\t"]:
        phone = phone.replace(ch, "")
    if not phone.startswith("+"):
        phone = "+" + phone
    return phone.strip()

def get_client_strict(phone: str):
    """Ищет клиент ТОЛЬКО по точному номеру — не переключается на другой"""
    p = norm(phone)
    return clients.get(p)

def get_client_any(phone: str):
    """Ищет клиент по номеру, если не найден — берёт первый доступный"""
    p = norm(phone)
    if p in clients:
        return clients[p]
    if clients:
        return list(clients.values())[0]
    return None

# ── Эндпоинты ─────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "status": "ok",
        "connected": list(clients.keys()),
        "count": len(clients)
    }

@app.get("/api/check")
async def check():
    global API_ID, API_HASH
    API_ID, API_HASH = load_keys()
    has_keys = bool(API_ID and API_HASH)
    status   = "⚠️ Ключи не заданы"
    if has_keys:
        try:
            from telethon.sessions import MemorySession
            tc = TelegramClient(MemorySession(), API_ID, API_HASH)
            await asyncio.wait_for(tc.connect(), timeout=10)
            status = "✅ Соединение с Telegram OK"
            await tc.disconnect()
        except asyncio.TimeoutError:
            status = "❌ Таймаут подключения"
        except ApiIdInvalidError:
            status = "❌ Неверные api_id / api_hash"
        except Exception as e:
            status = f"❌ {e}"
    return {
        "backend":            "✅ Работает",
        "has_keys":           has_keys,
        "api_id":             API_ID,
        "connected_accounts": len(clients),
        "accounts":           list(clients.keys()),
        "tg_connect":         status,
    }

@app.post("/api/settings/keys")
async def update_keys(data: ApiKeys):
    global API_ID, API_HASH
    try:
        API_ID   = int(data.api_id.strip())
        API_HASH = data.api_hash.strip()
        save_keys(API_ID, API_HASH)
        return {"status": "ok", "api_id": API_ID}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/accounts")
async def get_accounts():
    result = []
    for phone, info in clients.items():
        me = info.get("me") or {}
        result.append({
            "phone":    phone,
            "label":    info.get("label", phone),
            "name":     me.get("name", phone),
            "username": me.get("username", ""),
        })
    return {"accounts": result}

@app.post("/api/accounts/add")
async def add_account(data: AddAcc):
    global API_ID, API_HASH
    API_ID, API_HASH = load_keys()
    if not API_ID or not API_HASH:
        return {"error": "Сначала сохрани API ключи в Настройках → Аккаунты"}

    phone  = norm(data.phone)
    digits = phone.lstrip("+")
    path   = os.path.join(SESSIONS_DIR, digits)

    print(f"[ADD] phone={phone}  label={data.label}  api_id={API_ID}")
    try:
        c = TelegramClient(path, API_ID, API_HASH)
        print("[ADD] connect...")
        await c.connect()
        print("[ADD] connected")

        if await c.is_user_authorized():
            me   = await c.get_me()
            name = f"{me.first_name or ''} {me.last_name or ''}".strip() or phone
            clients[phone] = {
                "client": c, "label": data.label,
                "me": {"id": me.id, "name": name,
                       "username": me.username or "", "phone": phone}
            }
            setup_handlers(c, phone)
            print(f"[ADD] ✅ уже авторизован: {name}")
            return {"status": "authorized", "name": name}

        print("[ADD] отправляем код...")
        sent      = await c.send_code_request(phone)
        code_hash = sent.phone_code_hash
        delivery  = type(sent.type).__name__
        is_app    = "App" in delivery

        print(f"[ADD] ✅ код отправлен  hash={code_hash[:8]}")
        print(f"[ADD] тип доставки: {delivery}  (следующий: нет)")
        print(f"[ADD] {'📱 Код отправлен в ПРИЛОЖЕНИЕ Telegram (не SMS!)' if is_app else '💬 Код отправлен по SMS'}")

        phone_codes[phone] = {"client": c, "label": data.label, "hash": code_hash}
        return {
            "status":   "code_sent",
            "delivery": delivery,
            "message":  "📱 Код отправлен в приложение Telegram" if is_app else "💬 Код отправлен по SMS",
        }

    except FloodWaitError as e:
        return {"error": f"Подождите {e.seconds} секунд и попробуйте снова"}
    except PhoneNumberInvalidError:
        return {"error": f"Неверный номер: {phone}. Используй формат: +79001234567"}
    except ApiIdInvalidError:
        return {"error": "Неверные api_id / api_hash — проверь keys.json"}
    except Exception as e:
        print(f"[ADD] ❌ {type(e).__name__}: {e}")
        return {"error": f"{type(e).__name__}: {e}"}

@app.post("/api/accounts/confirm")
async def confirm_account(data: ConfirmAcc):
    phone = norm(data.phone)
    info  = phone_codes.get(phone)
    if not info:
        return {"error": "Сначала запроси код — нажми 'Отправить код'"}

    c    = info["client"]
    code = data.code.strip()
    try:
        await c.sign_in(phone, code, phone_code_hash=info["hash"])
    except SessionPasswordNeededError:
        if data.password:
            try:
                await c.sign_in(password=data.password)
            except Exception as e:
                return {"error": f"Неверный пароль 2FA: {e}"}
        else:
            return {"error": "Нужен пароль 2FA", "need_2fa": True}
    except PhoneCodeInvalidError:
        return {"error": "Неверный код — проверь и введи снова"}
    except PhoneCodeExpiredError:
        phone_codes.pop(phone, None)
        return {"error": "Код устарел — нажми 'Отправить код' снова"}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

    me   = await c.get_me()
    name = f"{me.first_name or ''} {me.last_name or ''}".strip() or phone
    clients[phone] = {
        "client": c, "label": info["label"],
        "me": {"id": me.id, "name": name,
               "username": me.username or "", "phone": phone}
    }
    setup_handlers(c, phone)
    phone_codes.pop(phone, None)
    print(f"[CONFIRM] ✅ {phone} ({name})")
    return {"status": "ok", "name": name}

@app.post("/api/accounts/disconnect")
async def disconnect_account(data: dict):
    """Отключить аккаунт (сделать неактивным без удаления сессии)"""
    phone = norm(data.get("phone", ""))
    info  = clients.get(phone)
    if not info:
        return {"error": "Аккаунт не найден"}
    try:
        await info["client"].disconnect()
        del clients[phone]
        print(f"[DISCONNECT] {phone} отключён")
        return {"status": "disconnected"}
    except Exception as e:
        return {"error": str(e)}

# ── Диалоги ───────────────────────────────────────────────────────────────────

@app.get("/api/dialogs/{phone}")
async def get_dialogs(phone: str):
    phone = norm(phone)
    info  = get_client_strict(phone)

    if not info:
        avail = list(clients.keys())
        return {
            "error":   f"Аккаунт {phone} не подключён. Доступные: {avail}",
            "dialogs": [],
        }

    c = info["client"]
    print(f"[DIALOGS] {phone} — загружаем...")

    try:
        dialogs = []
        count   = 0

        async for dialog in c.iter_dialogs(limit=None):
            entity = dialog.entity

            # Только личные чаты с живыми людьми
            if not isinstance(entity, User):
                continue
            if entity.bot:
                continue
            # Игнорируем системные аккаунты
            if entity.id in [777000, 42777, 93372553]:
                continue

            count += 1
            last_msg  = (dialog.message.message or "")[:120] if dialog.message else ""
            last_date = dialog.message.date.isoformat()       if dialog.message else ""

            dialogs.append({
                "id":               entity.id,
                "name":             f"{entity.first_name or ''} {entity.last_name or ''}".strip() or str(entity.id),
                "username":         entity.username or "",
                "phone":            getattr(entity, "phone", "") or "",
                "last_message":     last_msg,
                "last_date":        last_date,
                "unread_count":     dialog.unread_count,
                "tg_account_phone": phone,   # ← ВАЖНО: привязываем к нашему аккаунту
            })

            if count % 50 == 0:
                print(f"[DIALOGS] {phone}: загружено {count}...")
                await asyncio.sleep(0.03)

        print(f"[DIALOGS] ✅ {phone}: итого {count} диалогов")
        return {"dialogs": dialogs, "total": count, "phone": phone}

    except Exception as e:
        print(f"[DIALOGS] ❌ {e}")
        return {"error": str(e), "dialogs": []}

# ── Сообщения ─────────────────────────────────────────────────────────────────

@app.get("/api/messages/{phone}/{username}")
async def get_messages(phone: str, username: str):
    phone = norm(phone)

    # Сначала ищем строго по аккаунту лида
    info = get_client_strict(phone)
    if not info:
        # Если аккаунт не найден — пробуем любой доступный
        info = get_client_any(phone)

    if not info:
        return {"error": "Нет подключённых аккаунтов", "messages": []}

    actual_phone = norm(info["me"]["phone"]) if info.get("me") else phone
    c = info["client"]

    try:
        try:   entity = int(username)
        except ValueError: entity = username.lstrip("@")

        msgs = []
        async for msg in c.iter_messages(entity, limit=50):
            text       = msg.message or ""
            media_url  = ""
            media_type = ""

            if msg.media:
                try:
                    mtype = type(msg.media).__name__
                    sender_id = entity if not msg.out else "me"
                    ext = "jpg"

                    if "Photo" in mtype:
                        ext        = "jpg"
                        media_type = "photo"
                    elif "Document" in mtype:
                        doc = msg.media.document
                        for attr in doc.attributes:
                            if hasattr(attr, "file_name") and attr.file_name:
                                ext = attr.file_name.split(".")[-1].lower()
                                break
                        if any("Video" in type(a).__name__ for a in doc.attributes):
                            media_type = "video"
                            if ext not in ["mp4","mov","avi","mkv"]: ext = "mp4"
                        elif any("Sticker" in type(a).__name__ for a in doc.attributes):
                            media_type = "sticker"
                            if ext not in ["webp","tgs"]: ext = "webp"
                        else:
                            media_type = "document"
                    elif "Geo" in mtype:
                        lat = msg.media.geo.lat
                        lng = msg.media.geo.long
                        text = text or f"📍 Геолокация: {lat}, {lng}"
                        media_type = "geo"
                    elif "Contact" in mtype:
                        text = text or f"👤 Контакт: {getattr(msg.media,'first_name','')} {getattr(msg.media,'phone_number','')}"
                        media_type = "contact"

                    if media_type in ["photo","video","document","sticker"]:
                        fname = f"{sender_id}_{msg.id}.{ext}"
                        fpath = os.path.join(MEDIA_DIR, fname)
                        if not os.path.exists(fpath):
                            await c.download_media(msg, file=fpath)
                        if os.path.exists(fpath) and os.path.getsize(fpath) > 0:
                            media_url = f"http://localhost:8000/media/{fname}"
                except Exception as me:
                    print(f"[MEDIA_HIST] {me}")

            if text or media_url:
                msgs.append({
                    "id":               msg.id,
                    "text":             text,
                    "media_url":        media_url,
                    "media_type":       media_type,
                    "direction":        "outgoing" if msg.out else "incoming",
                    "sent_at":          msg.date.isoformat(),
                    "tg_account_phone": actual_phone,
                })
        msgs.reverse()
        print(f"[MESSAGES] {actual_phone}→{username}: {len(msgs)} сообщений")
        return {"messages": msgs, "phone": actual_phone}

    except Exception as e:
        print(f"[MESSAGES] ❌ {e}")
        return {"error": str(e), "messages": []}

# ── Отправка сообщения ────────────────────────────────────────────────────────

@app.post("/api/send")
async def send_message(data: SendMsg):
    phone = norm(data.phone)

    # Строго с того аккаунта который указан — не переключаемся!
    info = get_client_strict(phone)
    if not info:
        avail = list(clients.keys())
        return {"error": f"Аккаунт {phone} не подключён. Доступные: {avail}"}

    c = info["client"]
    try:
        try:   entity = int(data.username)
        except ValueError: entity = data.username.lstrip("@")

        await c.send_message(entity, data.text)

        # Рассылаем в WebSocket чтобы CRM обновился
        await broadcast({
            "type":             "new_message",
            "phone":            phone,
            "username":         data.username,
            "text":             data.text,
            "direction":        "outgoing",
            "sent_at":          datetime.now().isoformat(),
            "tg_account_phone": phone,
        })

        print(f"[SEND] ✅ {phone} → {data.username}: {data.text[:60]}")
        return {"status": "sent"}

    except Exception as e:
        print(f"[SEND] ❌ {e}")
        return {"error": str(e)}

# ── Отправка медиафайла ───────────────────────────────────────────────────────

@app.post("/api/send-media")
async def send_media(
    phone: str    = Form(...),
    username: str = Form(...),
    caption: str  = Form(""),
    file: UploadFile = File(...)
):
    p    = norm(phone)
    info = get_client_strict(p)
    if not info:
        return {"error": f"Аккаунт {p} не подключён"}

    c = info["client"]
    try:
        # Сохраняем файл временно
        ext      = file.filename.split(".")[-1].lower() if "." in file.filename else "jpg"
        tmp_path = os.path.join(MEDIA_DIR, f"tmp_{datetime.now().timestamp():.0f}.{ext}")
        content  = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(content)

        try:   entity = int(username)
        except ValueError: entity = username.lstrip("@")

        # Определяем тип медиа
        await c.send_file(entity, tmp_path, caption=caption or None)

        # Определяем тип для WS
        fname = file.filename.lower()
        if any(fname.endswith(x) for x in [".jpg",".jpeg",".png",".gif",".webp"]):
            media_type = "photo"
        elif any(fname.endswith(x) for x in [".mp4",".mov",".avi",".mkv"]):
            media_type = "video"
        else:
            media_type = "document"

        # Сохраняем постоянно
        final_name = f"out_{datetime.now().timestamp():.0f}.{ext}"
        final_path = os.path.join(MEDIA_DIR, final_name)
        os.rename(tmp_path, final_path)
        media_url  = f"http://localhost:8000/media/{final_name}"

        await broadcast({
            "type":             "new_message",
            "phone":            p,
            "username":         username,
            "text":             caption,
            "media_url":        media_url,
            "media_type":       media_type,
            "direction":        "outgoing",
            "sent_at":          datetime.now().isoformat(),
            "tg_account_phone": p,
        })

        print(f"[MEDIA_SEND] ✅ {p} → {username}: [{media_type}] {file.filename}")
        return {"status": "sent", "media_url": media_url, "media_type": media_type}

    except Exception as e:
        print(f"[MEDIA_SEND] ❌ {e}")
        if os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass
        return {"error": str(e)}

# ── Профиль + аватарка ────────────────────────────────────────────────────────

@app.get("/api/profile/{phone}/{username}")
async def get_profile(phone: str, username: str):
    phone = norm(phone)
    info  = get_client_strict(phone) or get_client_any(phone)
    if not info:
        return {"error": "Нет подключённых аккаунтов"}

    c = info["client"]
    try:
        try:   entity_id = int(username)
        except ValueError: entity_id = username.lstrip("@")

        user = await c.get_entity(entity_id)

        # Скачиваем аватарку
        avatar_url = ""
        try:
            safe_name = str(username).replace("/", "_").replace("\\", "_")
            path = os.path.join(AVATARS_DIR, f"{safe_name}.jpg")
            await c.download_profile_photo(user, file=path)
            if os.path.exists(path) and os.path.getsize(path) > 0:
                avatar_url = f"http://localhost:8000/avatars/{safe_name}.jpg"
        except Exception:
            pass

        return {
            "id":         user.id,
            "first_name": getattr(user, "first_name", "") or "",
            "last_name":  getattr(user, "last_name",  "") or "",
            "username":   getattr(user, "username",   "") or "",
            "phone":      getattr(user, "phone",      "") or "",
            "tg_link":    f"https://t.me/{user.username}" if getattr(user, "username", "") else "",
            "avatar_url": avatar_url,
        }
    except Exception as e:
        return {"error": str(e)}

# ── Быстрые ответы из TG Business ────────────────────────────────────────────

@app.get("/api/quick-replies/{phone}")
async def get_quick_replies(phone: str):
    phone = norm(phone)
    info  = get_client_strict(phone) or get_client_any(phone)
    if not info:
        return {"error": "Аккаунт не найден", "replies": []}

    c = info["client"]
    try:
        from telethon.tl.functions.messages import GetQuickRepliesRequest
        result = await c(GetQuickRepliesRequest())
        replies = []
        for qr in result.quick_replies:
            replies.append({
                "shortcut": qr.shortcut,
                "top_message": qr.top_message,
            })
        return {"replies": replies, "source": "telegram"}
    except Exception:
        return {"replies": [], "source": "not_available",
                "note": "Требуется Telegram Business подписка"}

# ── Запуск ────────────────────────────────────────────────────────────────────

async def main():
    global API_ID, API_HASH
    API_ID, API_HASH = load_keys()

    print("=" * 60)
    print("  TG Card CRM — Backend")
    print("=" * 60)
    if API_ID and API_HASH:
        print(f"  ✅ API ID:   {API_ID}")
        print(f"  ✅ API Hash: {str(API_HASH)[:8]}...")
    else:
        print("  ⚠️  Ключи не найдены!")
        print('  Создай файл backend/keys.json:')
        print('  {"api_id": 12345678, "api_hash": "твой_hash"}')
    print("=" * 60)
    print("  http://localhost:8000")
    print("  http://localhost:8000/api/check  ← диагностика")
    print("=" * 60)

    await load_sessions()

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()

if __name__ == "__main__":
    asyncio.run(main())
