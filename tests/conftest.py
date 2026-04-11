"""
Global test fixtures for Cafeteca.

Key design decisions:
- db.db_conn() opens a NEW connection each call; with :memory: each connection is an
  empty DB. The _ConnHolder pattern makes every call reuse the same per-test connection.
- app.py has two module-level side effects (secret_key + init_db). Both are suppressed
  at conftest load time so the first `import app` is safe.
- All patches are done at conftest module level (before any test file imports anything).
"""
import sqlite3
import pytest
from contextlib import contextmanager

# ---------------------------------------------------------------------------
# 1. Patch db.py BEFORE importing anything that uses it
# ---------------------------------------------------------------------------
import db as _db_module

_original_get_db = _db_module.get_db
_original_db_conn = _db_module.db_conn


class _ConnHolder:
    conn = None


_holder = _ConnHolder()


def _get_db():
    return _holder.conn


@contextmanager
def _db_conn():
    conn = _holder.conn
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


_db_module.get_db = _get_db
_db_module.db_conn = _db_conn

# ---------------------------------------------------------------------------
# 2. Import blueprints and schema so their module-level `from db import ...`
#    names get replaced with our patched versions.
# ---------------------------------------------------------------------------
import blueprints.auth as _auth_mod
import blueprints.coffees as _coffees_mod
import blueprints.stats as _stats_mod
import blueprints.settings as _settings_mod
import blueprints.lookup as _lookup_mod
import blueprints.brews as _brews_mod
import schema as _schema_mod

# Prevent init_db() from calling os.makedirs('/data') — the `if db_dir:` guard
# in schema.py skips makedirs when DB is '' (no directory component).
_schema_mod.DB = ''

for _mod in (_auth_mod, _coffees_mod, _stats_mod, _settings_mod,
             _lookup_mod, _brews_mod, _schema_mod):
    if hasattr(_mod, 'db_conn'):
        setattr(_mod, 'db_conn', _db_conn)
    if hasattr(_mod, 'get_db'):
        setattr(_mod, 'get_db', _get_db)

# ---------------------------------------------------------------------------
# 3. Suppress init_db() that runs at the bottom of app.py on first import
# ---------------------------------------------------------------------------
_original_init_db = _schema_mod.init_db
_schema_mod.init_db = lambda: None

import app as _app_module  # noqa: E402 — intentional late import

_schema_mod.init_db = _original_init_db  # restore for test_schema.py


# ---------------------------------------------------------------------------
# 4. Schema builder used by the db fixture
# ---------------------------------------------------------------------------
def _build_schema(conn):
    """Initialize the full schema on conn by delegating to init_db().

    init_db() uses db_conn() internally, which is patched to yield _holder.conn.
    As long as _holder.conn is set to `conn` before this call, all migrations
    run against the correct in-memory connection.
    """
    _original_init_db()
    conn.commit()


# ---------------------------------------------------------------------------
# 5. Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture()
def db():
    """Fresh in-memory SQLite DB per test, wired into the app via _holder."""
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    _holder.conn = conn
    _build_schema(conn)
    yield conn
    conn.close()
    _holder.conn = None


@pytest.fixture()
def app(db):
    _app_module.app.config.update({
        'TESTING': True,
        'SECRET_KEY': 'test-secret-key-fixed',
    })
    return _app_module.app


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def auth_client(app):
    """Test client with an active authenticated session."""
    c = app.test_client()
    with c.session_transaction() as sess:
        sess['authenticated'] = True
    return c
