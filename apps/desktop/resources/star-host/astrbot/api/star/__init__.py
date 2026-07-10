# astrbot.api.star — Tier 1：Context 占位 / Star 基类 / register 装饰器。
class Context:
    """Tier1 占位——provider/kb/db/platform 等未桥接，调用即明确报错（诚实降级）。"""

    def __getattr__(self, name):
        raise NotImplementedError(f'openpet star-host Tier1 未实现 Context.{name}')


class Star:
    def __init__(self, context: Context):
        self.context = context


_registered = []


def register(name, author='', desc='', version=''):
    def deco(cls):
        _registered.append(
            {'cls': cls, 'name': name, 'author': author, 'desc': desc, 'version': version}
        )
        return cls

    return deco
