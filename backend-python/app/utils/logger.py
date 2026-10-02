"""Minimal logger utility."""

import logging
import re
import sys

_SECRET_PARAM = re.compile(r"(?i)\b(key|apikey|api_key|token|access_token)=[^&\s\"']+")


class RedactSecretsFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _SECRET_PARAM.sub(r"\1=***", record.getMessage())
        record.args = None
        return True


logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

for _handler in logging.getLogger().handlers:
    _handler.addFilter(RedactSecretsFilter())

for _noisy in ("httpx", "httpx2", "httpcore", "httpcore2", "openai._base_client", "urllib3"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger("tripwhat")
