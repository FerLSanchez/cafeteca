"""Tests for database schema initialization and migrations."""
import sqlite3
import pytest
import schema as schema_mod
from schema import (
    init_settings, migrate_v3, migrate_v4, migrate_v5, migrate_v6,
    _pin_hash,
)
from lookup_config import create_lookup_tables


def fresh_conn():
    """Return a bare in-memory connection (no schema)."""
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def _base_schema(conn):
    """Create the minimum schema needed for migration tests."""
    create_lookup_tables(conn)
    conn.execute('''CREATE TABLE IF NOT EXISTS coffees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        roaster_id INTEGER, producer_id INTEGER, origin_id INTEGER,
        region_id INTEGER, shop_id INTEGER,
        quantity_g INTEGER, remaining_g INTEGER, price_kg REAL,
        purchase_date TEXT, roast_date TEXT, opened_date TEXT,
        finished_date TEXT, rating INTEGER, notes TEXT, altitude INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()


# ---------------------------------------------------------------------------
# init_settings
# ---------------------------------------------------------------------------
@pytest.mark.slow
def test_init_settings_creates_settings_table():
    conn = fresh_conn()
    init_settings(conn)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert 'settings' in tables
    conn.close()


def test_init_settings_default_pin():
    conn = fresh_conn()
    init_settings(conn)
    row = conn.execute("SELECT value FROM settings WHERE key='pin_hash'").fetchone()
    assert row is not None
    assert row[0] == _pin_hash('1111')
    conn.close()


def test_init_settings_default_grams_per_shot():
    conn = fresh_conn()
    init_settings(conn)
    row = conn.execute("SELECT value FROM settings WHERE key='grams_per_shot'").fetchone()
    assert row is not None
    assert int(row[0]) == 17
    conn.close()


def test_init_settings_idempotent():
    conn = fresh_conn()
    init_settings(conn)
    init_settings(conn)  # second call must not fail or duplicate
    count = conn.execute("SELECT COUNT(*) FROM settings WHERE key='pin_hash'").fetchone()[0]
    assert count == 1
    conn.close()


# ---------------------------------------------------------------------------
# migrate_v3
# ---------------------------------------------------------------------------
def test_migrate_v3_seeds_milk_types():
    conn = fresh_conn()
    create_lookup_tables(conn)
    migrate_v3(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM milk_types").fetchall()}
    assert names == {'Avena', 'Arroz', 'Almendras', 'Soja', 'Coco', 'Avellanas'}
    conn.close()


def test_migrate_v3_idempotent():
    conn = fresh_conn()
    create_lookup_tables(conn)
    migrate_v3(conn)
    migrate_v3(conn)
    count = conn.execute("SELECT COUNT(*) FROM milk_types WHERE name='Avena'").fetchone()[0]
    assert count == 1
    conn.close()


# ---------------------------------------------------------------------------
# migrate_v4
# ---------------------------------------------------------------------------
def test_migrate_v4_adds_remaining_g_if_missing():
    conn = fresh_conn()
    # Create coffees table WITHOUT remaining_g
    create_lookup_tables(conn)
    conn.execute('''CREATE TABLE coffees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        quantity_g INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    migrate_v4(conn)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(coffees)").fetchall()]
    assert 'remaining_g' in cols
    conn.close()


def test_migrate_v4_sets_remaining_from_quantity():
    conn = fresh_conn()
    create_lookup_tables(conn)
    conn.execute('''CREATE TABLE coffees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        quantity_g INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute("INSERT INTO coffees (name, quantity_g) VALUES ('Old Coffee', 500)")
    conn.commit()
    migrate_v4(conn)
    row = conn.execute("SELECT remaining_g FROM coffees WHERE name='Old Coffee'").fetchone()
    assert row[0] == 500
    conn.close()


def test_migrate_v4_noop_if_column_exists():
    conn = fresh_conn()
    _base_schema(conn)  # already has remaining_g
    migrate_v4(conn)  # must not raise
    cols = [r[1] for r in conn.execute("PRAGMA table_info(coffees)").fetchall()]
    assert 'remaining_g' in cols
    conn.close()


# ---------------------------------------------------------------------------
# migrate_v5 (FTS5)
# ---------------------------------------------------------------------------
@pytest.mark.slow
def test_migrate_v5_sets_fts_enabled_flag():
    conn = fresh_conn()
    _base_schema(conn)
    original = schema_mod.FTS_ENABLED
    migrate_v5(conn)
    fts_row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='coffees_fts'"
    ).fetchone()
    assert schema_mod.FTS_ENABLED == bool(fts_row)
    # restore
    schema_mod.FTS_ENABLED = original
    conn.close()


# ---------------------------------------------------------------------------
# migrate_v6
# ---------------------------------------------------------------------------
def test_migrate_v6_creates_recipes_and_brews_tables():
    conn = fresh_conn()
    _base_schema(conn)
    migrate_v6(conn)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert 'recipes' in tables
    assert 'brews' in tables
    assert 'coffee_recipes' in tables
    assert 'coffee_brews' in tables
    conn.close()


def test_migrate_v6_idempotent():
    conn = fresh_conn()
    _base_schema(conn)
    migrate_v6(conn)
    migrate_v6(conn)  # must not raise
    conn.close()


# ---------------------------------------------------------------------------
# Full init_db via conftest fixture (uses the real init_db through _build_schema)
# ---------------------------------------------------------------------------
def test_all_tables_created(db):
    """The db fixture calls _build_schema which mirrors init_db."""
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    expected = {'coffees', 'settings', 'roasters', 'producers', 'origins', 'regions',
                'shops', 'varieties', 'processes', 'milk_types',
                'coffee_varieties', 'coffee_processes', 'coffee_milk_types',
                'recipes', 'brews', 'coffee_recipes', 'coffee_brews'}
    assert expected.issubset(tables)


def test_schema_idempotent_via_fixture(db):
    """Running _build_schema again on the same connection must not fail."""
    from tests.conftest import _build_schema
    _build_schema(db)  # second run — should be a no-op
