# openpet star-host — stdio 行 JSON 宿主：加载 star-plugins 目录，事件分发（Tier 1）。
# 用法: python main.py <plugins_dir> [disabled_csv]
# 协议（每行一个 JSON）：
#   Main→host: {type:'event', id, origin, kind, senderId, senderName, text, isAdmin}
#   host→Main: {type:'plugins', list:[StarMeta]} / {type:'result', id, handled, replies}
#              / {type:'log', level, msg}
# stdout 只留协议帧；日志/异常走 stderr（astrbot shim logger 同约定）。
import asyncio
import importlib.util
import json
import os
import sys

# Windows 默认 gbk——协议帧必须 UTF-8（中文命令/回复）。
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # shim astrbot 包优先
from astrbot.api.event import AstrMessageEvent, filter as _filter, run_handler  # noqa: E402
from astrbot.api.star import _registered  # noqa: E402


def out(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def load_plugins(root, skip=None):
    skip = skip or set()
    metas = []
    dirs = sorted(os.listdir(root)) if os.path.isdir(root) else []
    for d in dirs:
        if d in skip:
            continue
        pdir = os.path.join(root, d)
        main = os.path.join(pdir, 'main.py')
        if not os.path.isfile(main):
            continue
        before = len(_filter._handlers)
        try:
            spec = importlib.util.spec_from_file_location(f'star_{d}', main)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        except Exception as e:  # noqa: BLE001 — 单插件坏不拖垮宿主
            out({'type': 'log', 'level': 'error', 'msg': f'load {d} failed: {e}'})
            continue
        cmds = [k for (kind, k, _fn) in _filter._handlers[before:] if kind == 'command']
        reg = _registered[-1] if _registered else {}
        metas.append(
            {
                'dir': d,
                'name': reg.get('name', d),
                'author': reg.get('author', ''),
                'desc': reg.get('desc', ''),
                'version': reg.get('version', ''),
                'commands': cmds,
            }
        )
    return metas


async def handle(ev):
    text = ev.get('text', '').strip()
    bare = text[1:] if text.startswith('/') else text
    head = bare.split(' ', 1)[0]
    event = AstrMessageEvent(
        ev.get('origin', ''),
        ev.get('kind', 'private'),
        ev.get('senderId', ''),
        ev.get('senderName', ''),
        bare,
        ev.get('isAdmin', False),
    )
    handled = False
    for kind, key, fn in list(_filter._handlers):
        try:
            if kind == 'command' and head == key:
                handled = True
                await run_handler(fn, None, event)
            elif kind == 'message':
                # Tier1：message 型 handler 不短路 LLM——仅命令短路（spec §3 接入点语义）。
                pass
        except Exception as e:  # noqa: BLE001
            out({'type': 'log', 'level': 'error', 'msg': f'handler {key} failed: {e}'})
    out({'type': 'result', 'id': ev.get('id'), 'handled': handled, 'replies': event.replies})


async def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    skip = {d for d in (sys.argv[2] if len(sys.argv) > 2 else '').split(',') if d}
    metas = load_plugins(root, skip)
    out({'type': 'plugins', 'list': metas})
    loop = asyncio.get_event_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        try:
            ev = json.loads(line)
        except Exception:  # noqa: BLE001 — 坏行丢弃
            continue
        if ev.get('type') == 'event':
            await handle(ev)


asyncio.run(main())
