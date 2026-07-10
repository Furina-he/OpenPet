# astrbot.api.message_components — Tier 1 纯文本段：Plain / At。
class Plain:
    def __init__(self, text=''):
        self.text = text


class At:
    def __init__(self, qq='', name=''):
        self.qq = qq
        self.name = name
        self.text = f'@{name or qq}'
