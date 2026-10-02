FROM python:3.12-slim

WORKDIR /app

COPY . .
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 5000

# --proxy-headers trusts X-Forwarded-For/Proto from FORWARDED_ALLOW_IPS
# (default: 127.0.0.1) — needed for correct rate-limit client IPs and
# OAuth redirects behind a reverse proxy.
CMD ["uvicorn", "app.main:asgi_app", "--host", "0.0.0.0", "--port", "5000", "--proxy-headers"]
