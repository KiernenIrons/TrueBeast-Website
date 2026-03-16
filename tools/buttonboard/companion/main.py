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

# ── Action executor ────────────────────────────────────────────────────────────
def execute_action(data: dict) -> bool:
    t = data.get("type")
    try:
        if t == "shortcut":
            keys = data.get("keys", [])
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
        icon.notify(f"WiFi IP for your tablet:\n{ip}:{PORT}", "ButtonBoard")

    def menu_quit(icon, item):
        stop_bluetooth()
        icon.stop()
        sys.exit(0)

    startup_label = f"Start with {'Windows' if SYSTEM == 'Windows' else 'Mac'}"

    def _build_menu():
        return pystray.Menu(
            pystray.MenuItem(f"WiFi: {ip}:{PORT}", menu_show_ip),
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
    ip = get_local_ip()
    print(f"\n  ButtonBoard is running!")
    print(f"  WiFi IP for your tablet: {ip}:{PORT}")
    print(f"  Check the system tray icon for options.\n")

    # Flask runs in a background daemon thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()

    # Tray icon runs on the main thread (required by most OS)
    tray = create_tray_icon()
    tray.run()
