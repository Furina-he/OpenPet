# 参考 Star 插件（fixture + F-PL-08 文档示例）：/签到 命令即答。
# Tier1 兼容面：模块级 handler（装饰器在类体内的真插件类方法绑定归 Tier2，见 RESULTS 已知限制）。
from astrbot.api.event import filter, AstrMessageEvent
from astrbot.api.star import Context, Star, register


@register('checkin', 'openpet', '签到示例', '1.0.0')
class CheckinPlugin(Star):
    def __init__(self, context: Context):
        super().__init__(context)


@filter.command('签到')
async def checkin(self, event: AstrMessageEvent):
    yield event.plain_result(f'{event.get_sender_name()} 签到成功 ✅')
