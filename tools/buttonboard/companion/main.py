"""
ButtonBoard Companion — truebeast.io/tools/buttonboard

Receives button taps from any phone/tablet browser over WiFi (HTTP)
or Android Chrome over Bluetooth (BLE), then executes the action on your PC/Mac.

Install:  pip install flask flask-cors pyautogui pystray pillow bless
Run:      python main.py
"""

import sys
import json
import socket
import platform
import threading
import subprocess
import asyncio
import logging

import pyautogui
from flask import Flask, request, jsonify
from flask_cors import CORS
import pystray
from PIL import Image, ImageDraw

# ── Optional BLE (Bluetooth) support ──────────────────────────────────────────
try:
    from bless import (
        BlessServer,
        BlessGATTCharacteristicProperties,
        BlessGATTCharacteristicPermissions,
    )
    BLE_AVAILABLE = True
except ImportError:
    BLE_AVAILABLE = False

# ── Constants ──────────────────────────────────────────────────────────────────
PORT            = 7474
BT_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb"
BT_CHAR_UUID    = "0000ffe1-0000-1000-8000-00805f9b34fb"
SYSTEM          = platform.system()   # 'Windows' or 'Darwin'

pyautogui.FAILSAFE = False

# ── Mac key name translation ────────────────────────────────────────────────────
# pyautogui on Mac uses 'command'/'option' not 'win'/'meta'
_MAC_KEY_MAP = {
    'win': 'command', 'windows': 'command', 'super': 'command', 'meta': 'command',
    'lwin': 'command', 'rwin': 'command',
}

def _translate_keys(keys: list) -> list:
    if SYSTEM == "Darwin":
        return [_MAC_KEY_MAP.get(k.lower(), k) for k in keys]
    return keys

# ── Accessibility check (Mac only) ────────────────────────────────────────────
def check_accessibility():
    if SYSTEM != "Darwin":
        return
    try:
        import ctypes
        ax = ctypes.cdll.LoadLibrary(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
        )
        if not ax.AXIsProcessTrusted():
            print("\n  ⚠️  ACCESSIBILITY PERMISSION REQUIRED")
            print("  Keystrokes won't work without it. Fix:")
            print("  1. Open  System Settings → Privacy & Security → Accessibility")
            print("  2. Click the + button and add your Terminal app")
            print("     (Terminal, iTerm2, or whichever you're using)")
            print("  3. Toggle it ON, then restart ButtonBoard\n")
    except Exception:
        pass

# ── Action executor ────────────────────────────────────────────────────────────
def execute_action(data: dict) -> bool:
    t = data.get("type")
    try:
        if t == "shortcut":
            keys = _translate_keys(data.get("keys", []))
            if keys:
                pyautogui.hotkey(*keys)
        elif t == "media":
            pyautogui.press(data.get("key", ""))
        elif t == "open":
            subprocess.Popen(data.get("path", ""), shell=True)
        elif t == "text":
            pyautogui.typewrite(data.get("text", ""), interval=0.03)
        return True
    except Exception as e:
        print(f"[ButtonBoard] Action error: {e}")
        return False

# ── Companion board HTML (served over HTTP so /action calls work) ─────────────
BOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>ButtonBoard</title>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"></script>
<script>
firebase.initializeApp({
    apiKey: "AIzaSyClA0dmz4D3TDbhwvWmUeVinW6A18NQUUU",
    authDomain: "truebeast-support.firebaseapp.com",
    projectId: "truebeast-support",
    storageBucket: "truebeast-support.firebasestorage.app",
    messagingSenderId: "726473476878",
    appId: "1:726473476878:web:c4439471895d7edf9b255f"
});
</script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { width: 100%; height: 100%; background: #0a0a0f; color: #fff; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; touch-action: none; user-select: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes ripple-anim { to { transform: scale(4); opacity: 0; } }
#topbar { position: fixed; top: 0; left: 0; right: 0; height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: rgba(10,10,15,0.8); backdrop-filter: blur(8px); z-index: 10; }
#topbar-title { font-size: 0.85rem; font-weight: 600; color: rgba(255,255,255,0.7); }
#topbar-right { display: flex; align-items: center; gap: 10px; }
#fullscreen-btn { background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.5); font-size: 20px; padding: 4px 6px; border-radius: 8px; transition: color 0.15s; line-height: 1; }
#fullscreen-btn:active { color: #fff; }
#status-dot { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.2); transition: background 0.3s; flex-shrink: 0; }
#status-dot.ok { background: #22c55e; }
#status-dot.err { background: #ef4444; }
#grid-wrap { position: fixed; top: 44px; bottom: 0; left: 0; right: 0; padding: 10px; display: flex; align-items: stretch; }
#grid { flex: 1; display: grid; gap: 10px; }
.btn { border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: transform 0.1s, filter 0.1s; touch-action: manipulation; overflow: hidden; position: relative; }
.btn:active { transform: scale(0.93); filter: brightness(1.25); }
.btn.empty { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.05); cursor: default; pointer-events: none; }
.btn-icon { font-size: clamp(1.6rem, 4vw, 2.8rem); line-height: 1; }
.btn-label { font-size: clamp(0.6rem, 1.5vw, 0.9rem); font-weight: 600; text-align: center; padding: 0 8px; line-height: 1.2; }
.btn .ripple { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.25); transform: scale(0); animation: ripple-anim 0.4s linear; pointer-events: none; }
#no-config { position: fixed; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; }
#no-config h2 { font-size: 1.3rem; }
#no-config p { color: rgba(255,255,255,0.5); font-size: 0.9rem; line-height: 1.5; }
@media (orientation: landscape) and (max-height: 500px) {
    #topbar { height: 36px; }
    #grid-wrap { top: 36px; padding: 6px; }
    #grid { gap: 6px; }
    .btn { border-radius: 10px; gap: 4px; }
    .btn-icon { font-size: clamp(1rem, 4vh, 1.8rem); }
    .btn-label { font-size: clamp(0.45rem, 1.5vh, 0.75rem); }
}
</style>
</head>
<body>

<div id="loading-overlay" style="display:flex;position:fixed;inset:0;z-index:200;background:#090d18;align-items:center;justify-content:center;flex-direction:column;gap:16px;">
    <div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
    <p style="color:rgba(255,255,255,0.5);font-size:0.9rem;">Loading board...</p>
</div>

<div id="no-config">
    <div style="font-size:3rem">🎛️</div>
    <h2>No board found</h2>
    <p>Make sure you scanned the correct QR code from the ButtonBoard builder.</p>
</div>

<div id="topbar">
    <span id="topbar-title">🎛️ ButtonBoard</span>
    <div id="topbar-right">
        <button id="fullscreen-btn" title="Toggle fullscreen">⛶</button>
        <div id="status-dot" title="Connection status"></div>
    </div>
</div>

<div id="grid-wrap"><div id="grid"></div></div>

<script>
const params  = new URLSearchParams(location.search);
const boardId = params.get('id');
const loadingEl = document.getElementById('loading-overlay');

function showNoConfig() {
    document.getElementById('no-config').style.display = 'flex';
    document.getElementById('topbar').style.display = 'none';
    document.getElementById('grid-wrap').style.display = 'none';
    loadingEl.style.display = 'none';
}

if (!boardId) {
    showNoConfig();
} else {
    firebase.firestore().collection('buttonboards').doc(boardId).get()
        .then(snap => {
            loadingEl.style.display = 'none';
            if (snap.exists) init(snap.data());
            else showNoConfig();
        })
        .catch(() => { loadingEl.style.display = 'none'; showNoConfig(); });
}

function init(cfg) {
    const dot = document.getElementById('status-dot');

    document.getElementById('fullscreen-btn').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    });

    function setStatus(s) { dot.className = ''; if (s) dot.classList.add(s); }
    let flashTimer;
    function flashStatus() {
        clearTimeout(flashTimer);
        setStatus('ok');
        flashTimer = setTimeout(() => setStatus(''), 800);
    }

    async function sendAction(action) {
        try {
            const res = await fetch('/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(action),
            });
            if (res.ok) flashStatus(); else setStatus('err');
        } catch { setStatus('err'); }
    }

    const { cols, rows } = cfg.grid;
    const grid = document.getElementById('grid');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

    const totalSlots = cols * rows;
    const btnMap = {};
    (cfg.buttons || []).forEach(b => { btnMap[b.id] = b; });

    for (let i = 0; i < totalSlots; i++) {
        const b  = btnMap[i];
        const el = document.createElement('div');
        el.className = b ? 'btn' : 'btn empty';
        if (b) {
            el.style.background = b.color || '#1a1a2e';
            const icon = document.createElement('div');
            icon.className = 'btn-icon';
            icon.textContent = b.icon || '⬜';
            el.appendChild(icon);
            if (b.label) {
                const label = document.createElement('div');
                label.className = 'btn-label';
                label.textContent = b.label;
                el.appendChild(label);
            }
            el.addEventListener('pointerdown', e => {
                const rect = el.getBoundingClientRect();
                const ripple = document.createElement('span');
                ripple.className = 'ripple';
                const size = Math.max(rect.width, rect.height);
                ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
                el.appendChild(ripple);
                ripple.addEventListener('animationend', () => ripple.remove());
                sendAction(b.action);
            });
        }
        grid.appendChild(el);
    }
}
</script>
</body>
</html>"""

# ── Flask HTTP server (WiFi) ───────────────────────────────────────────────────
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)

@app.route("/ping")
def ping():
    return "ok"

@app.route("/action", methods=["POST"])
def action():
    data = request.get_json(force=True) or {}
    ok = execute_action(data)
    return jsonify(ok=ok)

@app.route("/board")
@app.route("/")
def serve_board():
    return BOARD_HTML, 200, {"Content-Type": "text/html; charset=utf-8"}

def run_flask():
    app.run(host="0.0.0.0", port=PORT, threaded=True, use_reloader=False)

# ── BLE GATT server (Bluetooth) ────────────────────────────────────────────────
_bt_server   = None
_bt_loop     = None
_bt_enabled  = False
_bt_lock     = threading.Lock()

def _write_handler(characteristic, value: bytearray):
    try:
        data = json.loads(value.decode("utf-8"))
        execute_action(data)
    except Exception as e:
        print(f"[ButtonBoard] BLE write error: {e}")

async def _run_ble():
    global _bt_server
    try:
        server = BlessServer(name="ButtonBoard", loop=asyncio.get_event_loop())
        server.write_request_func = _write_handler

        await server.add_new_service(BT_SERVICE_UUID)
        await server.add_new_characteristic(
            BT_SERVICE_UUID,
            BT_CHAR_UUID,
            BlessGATTCharacteristicProperties.write
            | BlessGATTCharacteristicProperties.write_without_response,
            None,
            BlessGATTCharacteristicPermissions.writeable,
        )
        await server.start()
        _bt_server = server
        print("[ButtonBoard] Bluetooth server started — advertising as 'ButtonBoard'")

        while _bt_enabled:
            await asyncio.sleep(0.5)

        await server.stop()
        _bt_server = None
        print("[ButtonBoard] Bluetooth server stopped")
    except Exception as e:
        print(f"[ButtonBoard] BLE error: {e}")

def _bt_thread_fn():
    global _bt_loop
    _bt_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_bt_loop)
    _bt_loop.run_until_complete(_run_ble())
    _bt_loop.close()

def start_bluetooth():
    global _bt_enabled
    if not BLE_AVAILABLE:
        return False
    with _bt_lock:
        if _bt_enabled:
            return True
        _bt_enabled = True
    t = threading.Thread(target=_bt_thread_fn, daemon=True)
    t.start()
    return True

def stop_bluetooth():
    global _bt_enabled
    with _bt_lock:
        _bt_enabled = False

# ── Startup toggle (Windows / Mac) ────────────────────────────────────────────
def _get_exe() -> str:
    return sys.executable

def get_startup_enabled() -> bool:
    exe = _get_exe()
    if SYSTEM == "Windows":
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0, winreg.KEY_READ,
            )
            val, _ = winreg.QueryValueEx(key, "ButtonBoard")
            winreg.CloseKey(key)
            return val.strip('"') == exe
        except Exception:
            return False
    elif SYSTEM == "Darwin":
        import os
        plist = os.path.expanduser("~/Library/LaunchAgents/io.truebeast.buttonboard.plist")
        return os.path.exists(plist)
    return False

def set_startup(enable: bool):
    exe = _get_exe()
    if SYSTEM == "Windows":
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0, winreg.KEY_SET_VALUE,
        )
        if enable:
            winreg.SetValueEx(key, "ButtonBoard", 0, winreg.REG_SZ, f'"{exe}"')
        else:
            try:
                winreg.DeleteValue(key, "ButtonBoard")
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
    elif SYSTEM == "Darwin":
        import os
        plist_path = os.path.expanduser("~/Library/LaunchAgents/io.truebeast.buttonboard.plist")
        if enable:
            plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>io.truebeast.buttonboard</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>"""
            os.makedirs(os.path.dirname(plist_path), exist_ok=True)
            with open(plist_path, "w") as f:
                f.write(plist)
        else:
            if os.path.exists(plist_path):
                os.remove(plist_path)

# ── Local IP helper ────────────────────────────────────────────────────────────
def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# ── Tray icon ──────────────────────────────────────────────────────────────────
def make_icon() -> Image.Image:
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Purple rounded square background
    d.rounded_rectangle([2, 2, size - 2, size - 2], radius=12, fill=(124, 58, 237))
    # 3×3 grid of white dots
    for row in range(3):
        for col in range(3):
            cx = 14 + col * 18
            cy = 14 + row * 18
            d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(255, 255, 255))
    return img

def create_tray_icon():
    ip       = get_local_ip()
    bt_state = [False]   # mutable reference

    def menu_startup(icon, item):
        enabled = get_startup_enabled()
        set_startup(not enabled)
        icon.menu = _build_menu()

    def menu_bluetooth(icon, item):
        if not BLE_AVAILABLE:
            icon.notify("Install 'bless' (pip install bless) to enable Bluetooth.", "ButtonBoard")
            return
        bt_state[0] = not bt_state[0]
        if bt_state[0]:
            start_bluetooth()
            icon.notify(f"Bluetooth ON — device name: ButtonBoard", "ButtonBoard")
        else:
            stop_bluetooth()
            icon.notify("Bluetooth OFF", "ButtonBoard")
        icon.menu = _build_menu()

    def menu_show_ip(icon, item):
        icon.notify(f"Open on your tablet:\nhttp://{ip}:{PORT}/board?id=YOUR_BOARD_ID\n\nOr enter {ip} in the ButtonBoard builder QR page.", "ButtonBoard")

    def menu_quit(icon, item):
        stop_bluetooth()
        icon.stop()
        sys.exit(0)

    startup_label = f"Start with {'Windows' if SYSTEM == 'Windows' else 'Mac'}"

    def _build_menu():
        return pystray.Menu(
            pystray.MenuItem(f"Board URL: http://{ip}:{PORT}/board", menu_show_ip),
            pystray.MenuItem(
                "Bluetooth (Android Chrome)",
                menu_bluetooth,
                checked=lambda _: bt_state[0],
                enabled=BLE_AVAILABLE,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                startup_label,
                menu_startup,
                checked=lambda _: get_startup_enabled(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit ButtonBoard", menu_quit),
        )

    icon = pystray.Icon(
        "ButtonBoard",
        make_icon(),
        f"ButtonBoard  {ip}:{PORT}",
        menu=_build_menu(),
    )
    return icon

# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    check_accessibility()
    ip = get_local_ip()
    print(f"\n  ButtonBoard is running!")
    print(f"  Open on your tablet: http://{ip}:{PORT}/board?id=YOUR_BOARD_ID")
    print(f"  (Replace YOUR_BOARD_ID with the ID from the QR code URL)")
    print(f"  Check the system tray icon for options.\n")

    # Flask runs in a background daemon thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Tray icon runs on the main thread (required by most OS)
    tray = create_tray_icon()
    tray.run()
