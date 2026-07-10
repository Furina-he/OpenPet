# openpet star-host astrbot shim — clean-room 重实现 AstrBot 插件 API 表面子集（Tier 1）。
# 仅接口签名兼容，无上游代码；主仓 MIT。stdout 只留协议帧，日志一律走 stderr。
import logging
import sys

_handler = logging.StreamHandler(sys.stderr)
_handler.setFormatter(logging.Formatter('[star:%(levelname)s] %(message)s'))
logger = logging.getLogger('openpet.star')
logger.addHandler(_handler)
logger.setLevel(logging.INFO)
