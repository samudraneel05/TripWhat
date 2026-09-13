"""ImageCache ORM model — stores fetched image blobs for stable, cached serving."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import String, LargeBinary, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ImageCache(Base):
    __tablename__ = "image_cache"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    url_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    blob: Mapped[bytes] = mapped_column(LargeBinary)
    content_type: Mapped[str] = mapped_column(String(100), default="image/jpeg")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    fetched_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    last_accessed: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), index=True)

    @staticmethod
    def ttl() -> timedelta:
        return timedelta(days=7)
