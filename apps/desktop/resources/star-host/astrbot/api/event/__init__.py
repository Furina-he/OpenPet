# astrbot.api.event — Tier 1：AstrMessageEvent / MessageChain / filter 装饰器 / run_handler。
import inspect


class MessageChain:
    def __init__(self, chain=None):
        self.chain = chain or []

    def message(self, text):
        self.chain.append(text)
        return self


class MessageEventResult(MessageChain):
    pass


class AstrMessageEvent:
    def __init__(self, origin, kind, sender_id, sender_name, text, is_admin):
        self.unified_msg_origin = origin
        self.message_str = text
        self._kind, self._sender_id, self._sender_name = kind, sender_id, sender_name
        self.role = 'admin' if is_admin else 'member'
        self.replies, self._stopped = [], False

    def is_private_chat(self):
        return self._kind == 'private'

    def get_sender_id(self):
        return self._sender_id

    def get_sender_name(self):
        return self._sender_name

    def get_session_id(self):
        return self.unified_msg_origin

    def plain_result(self, text):
        r = MessageEventResult()
        r.message(text)
        return r

    async def send(self, chain):
        self.replies.append(_chain_text(chain))

    def stop_event(self):
        self._stopped = True


def _chain_text(chain):
    parts = []
    for c in getattr(chain, 'chain', []):
        parts.append(c if isinstance(c, str) else getattr(c, 'text', ''))
    return ''.join(parts)


class _Filter:
    def __init__(self):
        self._handlers = []  # (kind, key, fn)

    def command(self, name, **_kw):
        def deco(fn):
            self._handlers.append(('command', name, fn))
            return fn

        return deco

    def event_message_type(self, *_a, **_kw):
        def deco(fn):
            self._handlers.append(('message', None, fn))
            return fn

        return deco

    # Tier1 未实现的装饰器（permission/regex/platform…）：登记为 noop——插件可加载，该 handler 不触发。
    def __getattr__(self, _name):
        def deco(*_a, **_kw):
            def inner(fn):
                return fn

            return inner

        return deco


filter = _Filter()


class EventMessageType:
    """Tier1 占位枚举（filter.event_message_type 参数兼容）。"""

    ALL = 'all'
    PRIVATE_MESSAGE = 'private'
    GROUP_MESSAGE = 'group'


async def run_handler(fn, star, event):
    """兼容 async 函数 / async generator 两种 handler 形态，收集回复文本。"""
    out = fn(star, event)
    if inspect.isasyncgen(out):
        async for r in out:
            if r is not None:
                event.replies.append(_chain_text(r))
    else:
        r = await out
        if r is not None:
            event.replies.append(_chain_text(r))
