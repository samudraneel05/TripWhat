import logging

from app.utils.logger import RedactSecretsFilter


def _emit(name, msg):
    stream = []

    class Capture(logging.Handler):
        def emit(self, record):
            stream.append(self.format(record))

    handler = Capture()
    for f in logging.getLogger().handlers:
        for flt in f.filters:
            handler.addFilter(flt)
    target = logging.getLogger(name)
    target.addHandler(handler)
    try:
        target.warning(msg)
    finally:
        target.removeHandler(handler)
    return "\n".join(stream)


def test_tripwhat_logger_redacts_key_param():
    out = _emit("tripwhat", "GET https://x.test/api?key=SECRET&x=1")
    assert "SECRET" not in out
    assert "key=***&x=1" in out


def test_httpx_logger_redacts_key_param():
    out = _emit("httpx", 'HTTP Request: GET https://x.test/api?apikey=SECRET&x=1 "200 OK"')
    assert "SECRET" not in out


def test_noisy_loggers_default_to_warning():
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("urllib3").level == logging.WARNING


def test_root_handler_has_redaction_filter():
    assert any(
        isinstance(flt, RedactSecretsFilter)
        for h in logging.getLogger().handlers
        for flt in h.filters
    )
