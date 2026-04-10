"""Tests for models.py: validate_coffee, row_to_coffee, set_m2m, resolve_ids."""
import sqlite3
import pytest
from unittest.mock import MagicMock

from models import validate_coffee, row_to_coffee, set_m2m, resolve_ids, get_coffee_by_id


# ---------------------------------------------------------------------------
# validate_coffee
# ---------------------------------------------------------------------------
class TestValidateCoffee:
    def test_valid_minimal(self):
        assert validate_coffee({'name': 'X'}) is None

    def test_valid_full(self):
        data = {
            'name': 'Finca La Palma',
            'quantity_g': 250,
            'price_kg': 28.0,
            'rating': 4,
            'purchase_date': '2026-01-15',
            'roast_date': '2026-01-10',
            'varieties': ['Bourbon', 'Typica'],
            'processes': ['Washed'],
            'milk_types': ['Avena'],
            'notes': 'Notas de cata',
            'altitude': 1800,
        }
        assert validate_coffee(data) is None

    def test_missing_name(self):
        assert validate_coffee({}) is not None

    def test_empty_name(self):
        assert validate_coffee({'name': ''}) is not None

    def test_name_too_long(self):
        assert validate_coffee({'name': 'x' * 201}) is not None

    def test_name_exactly_200(self):
        assert validate_coffee({'name': 'x' * 200}) is None

    def test_none_data(self):
        assert validate_coffee(None) is not None

    def test_non_dict_data(self):
        assert validate_coffee('name') is not None

    # rating
    def test_rating_valid_boundaries(self):
        assert validate_coffee({'name': 'X', 'rating': 1}) is None
        assert validate_coffee({'name': 'X', 'rating': 5}) is None

    def test_rating_zero(self):
        assert validate_coffee({'name': 'X', 'rating': 0}) is not None

    def test_rating_six(self):
        assert validate_coffee({'name': 'X', 'rating': 6}) is not None

    def test_rating_float(self):
        assert validate_coffee({'name': 'X', 'rating': 3.5}) is not None

    def test_rating_bool_rejected(self):
        assert validate_coffee({'name': 'X', 'rating': True}) is not None

    def test_rating_none_allowed(self):
        assert validate_coffee({'name': 'X', 'rating': None}) is None

    # quantity
    def test_quantity_positive(self):
        assert validate_coffee({'name': 'X', 'quantity_g': 1}) is None

    def test_quantity_zero(self):
        assert validate_coffee({'name': 'X', 'quantity_g': 0}) is not None

    def test_quantity_negative(self):
        assert validate_coffee({'name': 'X', 'quantity_g': -1}) is not None

    def test_quantity_float(self):
        assert validate_coffee({'name': 'X', 'quantity_g': 250.5}) is not None

    def test_quantity_bool_rejected(self):
        assert validate_coffee({'name': 'X', 'quantity_g': True}) is not None

    # price
    def test_price_valid(self):
        assert validate_coffee({'name': 'X', 'price_kg': 0.01}) is None

    def test_price_zero(self):
        assert validate_coffee({'name': 'X', 'price_kg': 0}) is not None

    def test_price_negative(self):
        assert validate_coffee({'name': 'X', 'price_kg': -5.0}) is not None

    def test_price_bool_rejected(self):
        assert validate_coffee({'name': 'X', 'price_kg': True}) is not None

    # altitude
    def test_altitude_zero_allowed(self):
        assert validate_coffee({'name': 'X', 'altitude': 0}) is None

    def test_altitude_negative(self):
        assert validate_coffee({'name': 'X', 'altitude': -1}) is not None

    def test_altitude_bool_rejected(self):
        assert validate_coffee({'name': 'X', 'altitude': True}) is not None

    # dates
    def test_date_valid(self):
        assert validate_coffee({'name': 'X', 'purchase_date': '2026-01-15'}) is None

    def test_date_wrong_format(self):
        assert validate_coffee({'name': 'X', 'purchase_date': '01-15-2026'}) is not None

    def test_date_invalid_month(self):
        assert validate_coffee({'name': 'X', 'purchase_date': '2026-13-01'}) is not None

    def test_date_none_allowed(self):
        assert validate_coffee({'name': 'X', 'purchase_date': None}) is None

    # lookup fields length
    def test_roaster_too_long(self):
        assert validate_coffee({'name': 'X', 'roaster': 'r' * 201}) is not None

    # M2M fields
    def test_varieties_must_be_list(self):
        assert validate_coffee({'name': 'X', 'varieties': 'Bourbon'}) is not None

    def test_varieties_empty_list_ok(self):
        assert validate_coffee({'name': 'X', 'varieties': []}) is None

    def test_variety_item_too_long(self):
        assert validate_coffee({'name': 'X', 'varieties': ['x' * 201]}) is not None

    # notes
    def test_notes_max_length(self):
        assert validate_coffee({'name': 'X', 'notes': 'n' * 5000}) is None

    def test_notes_too_long(self):
        assert validate_coffee({'name': 'X', 'notes': 'n' * 5001}) is not None


# ---------------------------------------------------------------------------
# row_to_coffee
# ---------------------------------------------------------------------------
class TestRowToCoffee:
    def _make_row(self, **kwargs):
        defaults = {
            'id': 1, 'name': 'Test', 'quantity_g': 250, 'remaining_g': 250,
            'price_kg': 30.0, 'altitude': None,
            'purchase_date': None, 'roast_date': None, 'opened_date': None,
            'finished_date': None, 'rating': None, 'notes': None,
            'created_at': '2026-01-15',
            'roaster_id': None, 'roaster': None,
            'producer_id': None, 'producer': None,
            'origin_id': None, 'origin': None,
            'region_id': None, 'region': None,
            'shop_id': None, 'shop': None,
            'varieties_str': None, 'variety_ids_str': None,
            'processes_str': None, 'process_ids_str': None,
            'milk_types_str': None, 'milk_type_ids_str': None,
        }
        defaults.update(kwargs)
        # Simulate sqlite3.Row using a mock
        row = MagicMock()
        row.keys.return_value = list(defaults.keys())
        row.__iter__ = lambda self: iter(defaults.values())

        # Make dict(row) work
        def _getitem(key):
            return defaults[key]

        row.__getitem__ = lambda self, k: defaults[k]
        # Use a real dict instead
        return defaults

    def test_empty_m2m_gives_empty_lists(self):
        # Use a real sqlite3.Row-like object via a real in-memory DB
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('''CREATE TABLE t (
            id INTEGER, name TEXT, quantity_g INTEGER, remaining_g INTEGER,
            price_kg REAL, altitude INTEGER,
            purchase_date TEXT, roast_date TEXT, opened_date TEXT, finished_date TEXT,
            rating INTEGER, notes TEXT, created_at TEXT,
            roaster_id INTEGER, roaster TEXT, producer_id INTEGER, producer TEXT,
            origin_id INTEGER, origin TEXT, region_id INTEGER, region TEXT,
            shop_id INTEGER, shop TEXT,
            varieties_str TEXT, variety_ids_str TEXT,
            processes_str TEXT, process_ids_str TEXT,
            milk_types_str TEXT, milk_type_ids_str TEXT
        )''')
        conn.execute("INSERT INTO t VALUES (1,'X',250,250,30,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-01-01',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
        row = conn.execute("SELECT * FROM t").fetchone()
        d = row_to_coffee(row)
        assert d['varieties'] == []
        assert d['variety_ids'] == []
        assert d['processes'] == []
        assert d['milk_types'] == []
        conn.close()

    def test_varieties_parsed_from_pipe_separator(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('''CREATE TABLE t (
            id INTEGER, name TEXT, quantity_g INTEGER, remaining_g INTEGER,
            price_kg REAL, altitude INTEGER,
            purchase_date TEXT, roast_date TEXT, opened_date TEXT, finished_date TEXT,
            rating INTEGER, notes TEXT, created_at TEXT,
            roaster_id INTEGER, roaster TEXT, producer_id INTEGER, producer TEXT,
            origin_id INTEGER, origin TEXT, region_id INTEGER, region TEXT,
            shop_id INTEGER, shop TEXT,
            varieties_str TEXT, variety_ids_str TEXT,
            processes_str TEXT, process_ids_str TEXT,
            milk_types_str TEXT, milk_type_ids_str TEXT
        )''')
        conn.execute("INSERT INTO t VALUES (1,'X',250,250,30,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-01-01',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Bourbon|||Typica','1,2',NULL,NULL,NULL,NULL)")
        row = conn.execute("SELECT * FROM t").fetchone()
        d = row_to_coffee(row)
        assert d['varieties'] == ['Bourbon', 'Typica']
        assert d['variety_ids'] == [1, 2]
        conn.close()

    def test_raw_fields_removed_from_dict(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('''CREATE TABLE t (
            id INTEGER, name TEXT, quantity_g INTEGER, remaining_g INTEGER,
            price_kg REAL, altitude INTEGER,
            purchase_date TEXT, roast_date TEXT, opened_date TEXT, finished_date TEXT,
            rating INTEGER, notes TEXT, created_at TEXT,
            roaster_id INTEGER, roaster TEXT, producer_id INTEGER, producer TEXT,
            origin_id INTEGER, origin TEXT, region_id INTEGER, region TEXT,
            shop_id INTEGER, shop TEXT,
            varieties_str TEXT, variety_ids_str TEXT,
            processes_str TEXT, process_ids_str TEXT,
            milk_types_str TEXT, milk_type_ids_str TEXT
        )''')
        conn.execute("INSERT INTO t VALUES (1,'X',250,250,30,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-01-01',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
        row = conn.execute("SELECT * FROM t").fetchone()
        d = row_to_coffee(row)
        assert 'varieties_str' not in d
        assert 'variety_ids_str' not in d
        assert 'processes_str' not in d
        assert 'milk_types_str' not in d
        conn.close()


# ---------------------------------------------------------------------------
# set_m2m
# ---------------------------------------------------------------------------
class TestSetM2m:
    def _setup(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE)')
        conn.execute('CREATE TABLE coffees (id INTEGER PRIMARY KEY)')
        conn.execute('CREATE TABLE coffee_varieties (coffee_id INTEGER, variety_id INTEGER, PRIMARY KEY (coffee_id, variety_id))')
        conn.execute('INSERT INTO coffees VALUES (1)')
        conn.commit()
        return conn

    def test_set_creates_lookup_entries(self):
        conn = self._setup()
        set_m2m(conn, 1, ['Bourbon', 'Typica'], 'varieties', 'coffee_varieties', 'variety_id')
        names = {r[0] for r in conn.execute("SELECT name FROM varieties").fetchall()}
        assert names == {'Bourbon', 'Typica'}
        conn.close()

    def test_set_creates_junction_rows(self):
        conn = self._setup()
        set_m2m(conn, 1, ['Bourbon'], 'varieties', 'coffee_varieties', 'variety_id')
        count = conn.execute("SELECT COUNT(*) FROM coffee_varieties WHERE coffee_id=1").fetchone()[0]
        assert count == 1
        conn.close()

    def test_set_replaces_all(self):
        conn = self._setup()
        set_m2m(conn, 1, ['Bourbon', 'Typica'], 'varieties', 'coffee_varieties', 'variety_id')
        set_m2m(conn, 1, ['Gesha'], 'varieties', 'coffee_varieties', 'variety_id')
        rows = conn.execute("SELECT variety_id FROM coffee_varieties WHERE coffee_id=1").fetchall()
        assert len(rows) == 1
        name = conn.execute("SELECT name FROM varieties WHERE id=?", (rows[0][0],)).fetchone()[0]
        assert name == 'Gesha'
        conn.close()

    def test_set_empty_clears_all(self):
        conn = self._setup()
        set_m2m(conn, 1, ['Bourbon'], 'varieties', 'coffee_varieties', 'variety_id')
        set_m2m(conn, 1, [], 'varieties', 'coffee_varieties', 'variety_id')
        count = conn.execute("SELECT COUNT(*) FROM coffee_varieties WHERE coffee_id=1").fetchone()[0]
        assert count == 0
        conn.close()

    def test_set_accepts_csv_string(self):
        conn = self._setup()
        set_m2m(conn, 1, 'Bourbon, Typica', 'varieties', 'coffee_varieties', 'variety_id')
        count = conn.execute("SELECT COUNT(*) FROM coffee_varieties WHERE coffee_id=1").fetchone()[0]
        assert count == 2
        conn.close()


# ---------------------------------------------------------------------------
# resolve_ids
# ---------------------------------------------------------------------------
class TestResolveIds:
    def _setup(self):
        from lookup_config import create_lookup_tables
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        create_lookup_tables(conn)
        # Add origin_id column to regions (normally added by migrate_v2)
        conn.execute('ALTER TABLE regions ADD COLUMN origin_id INTEGER REFERENCES origins(id)')
        conn.commit()
        return conn

    def test_creates_roaster(self):
        conn = self._setup()
        ids = resolve_ids(conn, {'roaster': 'Ineffable'})
        assert ids['roaster_id'] is not None
        conn.close()

    def test_none_values_return_none(self):
        conn = self._setup()
        ids = resolve_ids(conn, {})
        assert ids['roaster_id'] is None
        assert ids['origin_id'] is None
        conn.close()

    def test_links_region_to_origin(self):
        conn = self._setup()
        resolve_ids(conn, {'origin': 'Ethiopia', 'region': 'Yirgacheffe'})
        row = conn.execute(
            "SELECT r.origin_id FROM regions r JOIN origins o ON r.origin_id=o.id "
            "WHERE r.name='Yirgacheffe' AND o.name='Ethiopia'"
        ).fetchone()
        assert row is not None
        conn.close()

    def test_reuses_existing_entries(self):
        conn = self._setup()
        ids1 = resolve_ids(conn, {'roaster': 'Shared'})
        ids2 = resolve_ids(conn, {'roaster': 'Shared'})
        assert ids1['roaster_id'] == ids2['roaster_id']
        count = conn.execute("SELECT COUNT(*) FROM roasters WHERE name='Shared'").fetchone()[0]
        assert count == 1
        conn.close()
