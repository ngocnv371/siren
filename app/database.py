from __future__ import annotations

import os
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_engine():
    global _engine
    if _engine is None:
        from app.config import get_config

        cfg = get_config()
        db_path = cfg.database.path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        _engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_path}",
            echo=False,
        )
    return _engine


def _get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            _get_engine(), expire_on_commit=False, class_=AsyncSession
        )
    return _session_factory


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with _get_session_factory()() as session:
        yield session


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the shared session factory for use outside of request context (e.g. background tasks)."""
    return _get_session_factory()


async def init_db() -> None:
    """Create all tables if they don't exist."""
    from app import models  # noqa: F401 — registers models with Base

    async with _get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Lightweight migration for existing SQLite DBs: add projects.profile if missing.
        table_info = await conn.exec_driver_sql("PRAGMA table_info(projects)")
        columns = {row[1] for row in table_info.fetchall()}
        if "profile" not in columns:
            await conn.exec_driver_sql(
                "ALTER TABLE projects ADD COLUMN profile TEXT NOT NULL DEFAULT 'default'"
            )
            await conn.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_projects_profile ON projects (profile)"
            )

        # Lightweight migration: add topics.profile and remove old UNIQUE(topic) constraint.
        topic_info = await conn.exec_driver_sql("PRAGMA table_info(topics)")
        topic_columns = {row[1] for row in topic_info.fetchall()}
        if "profile" not in topic_columns:
            await conn.execute(text(
                """CREATE TEMPORARY TABLE topics_backup(
                    id TEXT PRIMARY KEY,
                    topic TEXT,
                    created_at TEXT
                )"""
            ))
            await conn.execute(text(
                "INSERT INTO topics_backup SELECT id, topic, created_at FROM topics"
            ))
            await conn.execute(text("DROP TABLE IF EXISTS topics"))
            await conn.execute(text(
                """CREATE TABLE topics(
                    id TEXT PRIMARY KEY,
                    topic TEXT NOT NULL,
                    profile TEXT NOT NULL DEFAULT 'default',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(topic, profile)
                )"""
            ))
            await conn.execute(text(
                "INSERT INTO topics SELECT id, topic, 'default', created_at FROM topics_backup"
            ))
            await conn.execute(text("DROP TABLE topics_backup"))
