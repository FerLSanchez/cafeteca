"""Servidor local para los E2E: BD propia (nunca la de producción) en el puerto 5399.

    python tests/e2e/serve.py [ruta.db]     # sin ruta: BD temporal nueva

En el servidor, 127.0.0.1:5323 es PRODUCCIÓN: los E2E escriben datos, no los lances contra él.
"""
import os
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = 5399
FORBIDDEN = {os.path.realpath(p) for p in ('/data/coffee.db', os.path.join(REPO, 'data', 'coffee.db'))}


def resolve_db(arg):
    """Ruta de la BD de prueba; se niega a usar la de producción."""
    path = os.path.realpath(arg) if arg else os.path.join(tempfile.mkdtemp(prefix='cafeteca-e2e-'), 'coffee.db')
    if path in FORBIDDEN:
        raise SystemExit(f'Me niego a abrir la BD de producción: {path}')
    return path


def main():
    path = resolve_db(sys.argv[1] if len(sys.argv) > 1 else None)
    os.chdir(REPO)
    sys.path.insert(0, REPO)
    import db
    db.DB = path               # antes de importar app, que llama a init_db()
    import app as app_module
    print(f'BD de prueba: {path}\nhttp://localhost:{PORT}', flush=True)
    app_module.app.run(host='127.0.0.1', port=PORT, debug=False)


if __name__ == '__main__':
    main()
