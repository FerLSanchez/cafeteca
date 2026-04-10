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

SQLite con 7 tablas de referencia normalizadas (roasters, producers, varieties, origins, regions, processes, shops).

### Relaciones

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `coffees.roaster_id` | FK directa | N-1 con roasters |
| `coffees.producer_id` | FK directa | N-1 con producers |
| `coffees.origin_id` | FK directa | N-1 con origins (países) |
| `coffees.region_id` | FK directa | N-1 con regions |
| `coffees.shop_id` | FK directa | N-1 con shops |
| `coffee_varieties` | tabla de unión | M-N entre coffees y varieties |
| `coffee_processes` | tabla de unión | M-N entre coffees y processes |
| `regions.origin_id` | FK directa | N-1 con origins — cada región pertenece a un país |

### Dos categorías de lookup tables

- **`LOOKUP_FK`** — relación directa con FK en `coffees`: `roasters`, `producers`, `origins`, `regions`, `shops`
- **`JUNCTION_TABLES`** — relación M2M vía tabla de unión: `varieties` → `coffee_varieties`, `processes` → `coffee_processes`

Los endpoints de lookup (`/api/lookup/<table>`) y las funciones de conteo/borrado/purga distinguen ambas categorías internamente.

### Helpers clave en app.py

- `get_or_create(conn, table, name)` — crea o reutiliza una entrada en cualquier lookup table
- `resolve_ids(conn, data)` — resuelve strings de lookup a IDs y auto-vincula región→país
- `set_m2m(conn, coffee_id, values, ...)` — reemplaza todas las relaciones M2M de un café
- `row_to_coffee(row)` — convierte una fila SQLite a dict con arrays `varieties` y `processes`
- `COFFEE_SELECT` — query base con subconsultas GROUP_CONCAT para variedades y procesos

### Formato del API

- Campos de lookup simples: el frontend envía strings (`roaster: "Ineffable"`), el backend los resuelve con `resolve_ids()`
- Variedades y procesos: el frontend envía **arrays** (`varieties: ["Heirloom", "SL28"]`), el backend los gestiona con `set_m2m()`
- Las respuestas incluyen `varieties: [...]`, `variety_ids: [...]`, `processes: [...]`, `process_ids: [...]`
- `/api/options` devuelve regiones con `origin_id` para que el frontend pueda filtrar por país

## Autenticación por PIN

La app está protegida con un PIN de 4 dígitos. Por defecto es `1111`.

- **Pantalla de bloqueo**: se muestra al cargar la app; `startup()` comprueba `/api/auth/status` y, si ya hay sesión activa, salta directamente a `init()`.
- **Sesión Flask**: `session['authenticated'] = True` tras login correcto. La cookie es `HttpOnly` y `SameSite=Strict`.
- **Clave secreta**: generada aleatoriamente al primer arranque y guardada en `/data/secret_key`. Persiste entre reinicios del contenedor.
- **PIN almacenado**: como SHA-256 en la tabla `settings` (`key='pin_hash'`). Valor por defecto = hash de `'1111'`.
- **Cambiar PIN**: botón ⚙️ en la barra de navegación → modal "Cambiar PIN". Endpoint `POST /api/auth/change-pin` requiere el PIN actual.
- **`login_required`**: decorador en todos los endpoints `/api/*` excepto `/api/auth/status` y `/api/auth/login`.
- **`init_settings(conn)`**: crea la tabla `settings` e inserta el PIN por defecto si no existe. Se llama desde `init_db()`.

## Convenciones importantes

- La BD vive en `/data/coffee.db` (variable `DB` en `app.py`)
- `init_db()` se llama al arrancar y es idempotente — incluye todas las migraciones
- Hay dos fases de migración: `migrate_v1()` (texto→FK, legado) y `migrate_v2()` (FK→M2M + link región-país)
- Añadir un nuevo cambio de esquema: crear `migrate_v3()` y llamarla desde `init_db()`
- Todos los endpoints de lookup comprueban que `table` esté en `LOOKUP_TABLES` antes de ejecutar
- Las fechas se guardan como TEXT en formato `YYYY-MM-DD`
- `rating NULL` = sin valorar (nunca se guarda 0)
- El frontend define `LOOKUP_TABLES` como array JS — se sincroniza automáticamente desde `/api/options`

## Frontend — convenciones JS

- **Chip input** para variedades y procesos: estado en `selectedVarieties` / `selectedProcesses` (arrays), gestionado por `addChip()`, `removeChip()`, `renderChips()`
- `CHIP_FIELDS` — mapa que conecta tabla lookup con su estado y elementos DOM de chips
- **Cascada región→país**: `onOriginChange()` actualiza el hint de región en el formulario; `onFilterOriginChange()` filtra el desplegable de región en el panel de filtros avanzados
- `renderAC()` filtra automáticamente los chips ya seleccionados y las regiones por país

## Estado actual

La aplicación está en uso con datos reales. Cualquier cambio de esquema debe ir acompañado de una nueva función `migrate_vN()` llamada desde `init_db()`.

## Cómo probar localmente

```bash
pip install flask
python app.py
# → http://localhost:5323
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
