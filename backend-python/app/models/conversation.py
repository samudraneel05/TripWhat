"""Conversation ORM model."""

from datetime import datetime, timezone

from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, PortableJSON


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    messages: Mapped[list | None] = mapped_column(PortableJSON, nullable=True, default=list)
    meta: Mapped[dict | None] = mapped_column("metadata", PortableJSON, nullable=True, default=dict)
    # NOTE: the legacy `itinerary` column still exists in the DB but is no
    # longer mapped — it had zero readers/writers (itinerary lives inside
    # trip_state["itinerary"]). Left un-migrated intentionally.
    trip_state: Mapped[dict | None] = mapped_column(PortableJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    updated_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), onupdate=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
