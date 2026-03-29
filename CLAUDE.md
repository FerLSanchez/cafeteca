# CLAUDE.md — Cafeteca

Contexto para continuar el desarrollo de esta aplicación en Claude Code.

## Qué es

App web personal para registrar cafés de especialidad. Flask + SQLite + HTML/CSS/JS vanilla. Mobile-first, tema oscuro cálido. Corre en Docker.

## Ficheros relevantes

- `app.py` — toda la lógica backend: init de BD, migración automática, endpoints REST
- `templates/index.html` — todo el frontend en un único fichero (HTML + CSS + JS)
- `docker-compose.yml` — monta `./data` como volumen para persistir la BD
- `Dockerfile` — imagen Python 3.12-slim, solo depende de Flask

## Arquitectura de datos

SQLite con 7 tablas de referencia normalizadas (roasters, producers, varieties, origins, regions, processes, shops) referenciadas desde `coffees` mediante FKs opcionales. La función `get_or_create(conn, table, name)` en `app.py` gestiona la creación automática de entradas al guardar un café.

El frontend siempre envía los campos de lookup como **strings** (ej. `roaster: "Ineffable"`). El backend los resuelve a IDs con `resolve_ids()`. Las respuestas devuelven tanto el ID como el nombre resuelto (via JOIN en `COFFEE_SELECT`).

## Convenciones importantes

- La BD vive en `/data/coffee.db` (variable `DB` en `app.py`)
- `init_db()` se llama al arrancar y es idempotente — incluye la migración automática de columnas de texto antiguas
- Todos los endpoints de lookup comprueban que `table` esté en `LOOKUP_TABLES` antes de ejecutar
- Las fechas se guardan como TEXT en formato `YYYY-MM-DD`
- `rating NULL` = sin valorar (nunca se guarda 0)
- El frontend define `LOOKUP_TABLES` como array JS — debe mantenerse sincronizado con el Python si se añaden tablas

## Estado actual

La aplicación está en uso con datos reales. Cualquier cambio de esquema debe ir acompañado de migración en `init_db()` / `migrate()`.

## Cómo probar localmente

```bash
pip install flask
python app.py
# → http://localhost:5000
```

O con Docker:

```bash
docker compose up -d
```

## Posibles mejoras pendientes

- Exportar/importar datos (CSV o JSON)
- Foto de la bolsa del café
- Comparar dos cafés lado a lado
- Tiempo medio de consumo por café (días entre apertura y fin)
- Filtro por rango de precio o valoración mínima
