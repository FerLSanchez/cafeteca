import sqlite3
from contextlib import contextmanager

DB = '/data/coffee.db'


def get_db():
    conn = sqlite3.connect(DB, timeout=10)  # wait up to 10 s on a locked DB
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


@contextmanager
def db_conn():
    """Context manager that commits on success, rolls back on error, and always closes."""
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def col_exists(conn, table, col):
    cols = [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    return col in cols
