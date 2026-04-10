# Cafeteca ☕

Diario personal de cafés de especialidad. Registra compras, consumo, valoraciones y notas de cata. Interfaz web mobile-first, tema oscuro cálido. PWA instalable.

## Arrancar

```bash
docker compose up -d
```

Abre http://localhost:5323 en el móvil o navegador.

> **Primer uso:** el PIN por defecto es `1111`. Cámbialo desde el botón ⚙️ en la barra de navegación antes de usar la app.

Para parar:

```bash
docker compose down
```

## Desarrollo local (sin Docker)

```bash
pip install flask
python app.py
```

Los datos se guardan en `/data/coffee.db`. En local puedes cambiar la variable `DB` en `db.py` para usar una ruta distinta.

## Tests

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt -r requirements-test.txt  # Windows
# source .venv/bin/activate && pip install ...  # macOS/Linux

.venv/Scripts/pytest          # suite completa (227 tests)
.venv/Scripts/pytest --cov=. --cov-report=term-missing --cov-omit="tests/*"  # con cobertura
```

La suite cubre todos los endpoints REST, validación de modelos, relaciones M2M, migraciones de esquema y lógica de autenticación. Cada test arranca con una base de datos SQLite en memoria completamente inicializada — no toca `/data/coffee.db`.

## Estructura de ficheros

```
cafeteca/
├── app.py                  # Entry point Flask: config, blueprints, rutas /
├── db.py                   # Conexión SQLite, context manager db_conn, col_exists
├── lookup_config.py        # Constantes LOOKUP_TABLES/JUNCTION_TABLES/LOOKUP_FK,
│                           #   create_lookup_tables(), get_or_create()
├── models.py               # COFFEE_SELECT, row_to_coffee(), set_m2m(),
│                           #   resolve_ids(), validate_coffee()
├── schema.py               # init_db(), migraciones v1-v6, login_required, PIN
├── blueprints/
│   ├── auth.py             # /api/auth/*
│   ├── coffees.py          # /api/coffees/*
│   ├── stats.py            # /api/stats
│   ├── settings.py         # /api/settings, /api/options, /api/lookup-tables
│   ├── lookup.py           # /api/lookup/<table>/*
│   └── brews.py            # /api/coffees/:id/recipe, /api/coffees/:id/brews, /api/brews
├── templates/
│   └── index.html          # HTML + referencias a CSS y JS externos
├── static/
│   ├── css/
│   │   └── style.css       # Estilos de la aplicación
│   ├── js/
│   │   ├── state.js        # Variables globales
│   │   ├── api.js          # fetch wrapper, showToast, showConfirm, closeModal
│   │   ├── utils.js        # Formateadores: stars, fmtDate, fmtWeight, fmtPrice…
│   │   ├── chips.js        # Chip input multi-selección
│   │   ├── autocomplete.js # Autocompletar + cascada región→país
│   │   ├── options.js      # loadOptions(), populateFilterSelects()
│   │   ├── list.js         # fetchAndRender(), renderList(), showPage()
│   │   ├── filters.js      # Filtros de estado y panel avanzado
│   │   ├── detail.js       # Modal detalle, consumo, acciones rápidas
│   │   ├── form.js         # Formulario añadir/editar, ajustes
│   │   ├── stats.js        # Stats, gráficas, calendario
│   │   ├── catalog.js      # Gestión de catálogos
│   │   ├── brews.js        # Historial de preparaciones y receta
│   │   ├── pin.js          # Pantalla PIN
│   │   └── init.js         # Arranque, registro del service worker
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service worker
│   └── icon-*.png          # Iconos PWA
├── tests/
│   ├── conftest.py         # Fixtures: db, app, client, auth_client
│   ├── helpers.py          # make_coffee(), make_brew()
│   ├── test_schema.py      # Migraciones e init_db
│   ├── test_models.py      # validate_coffee, row_to_coffee, set_m2m, resolve_ids
│   ├── test_auth.py        # Login, status, change-pin
│   ├── test_coffees.py     # CRUD, filtros, open/finish/consume
│   ├── test_stats.py       # Estadísticas y breakdowns
│   ├── test_settings.py    # Configuración y opciones
│   ├── test_lookup.py      # Gestión de catálogos
│   └── test_brews.py       # Recetas y preparaciones
├── pytest.ini
├── requirements.txt
├── requirements-test.txt
├── Dockerfile
├── docker-compose.yml
└── data/                   # Creado automáticamente, contiene coffee.db
```

## Base de datos

SQLite. La migración corre automáticamente al arrancar — no hace falta ejecutar nada manualmente.

### Esquema

**Tablas de referencia (lookups)** — cada una con `id` y `name UNIQUE COLLATE NOCASE`:

| Tabla | Campo FK en coffees |
|---|---|
| roasters | roaster_id |
| producers | producer_id |
| origins | origin_id |
| regions | region_id |
| shops | shop_id |

**Tablas de unión (M2M):**

| Tabla | Descripción |
|---|---|
| varieties + coffee_varieties | Variedades del café |
| processes + coffee_processes | Procesos de beneficiado |
| milk_types + coffee_milk_types | Leches vegetales compatibles |

**Tabla `coffees`:**

| Campo | Tipo | Notas |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | Obligatorio |
| roaster_id | INTEGER FK | |
| producer_id | INTEGER FK | |
| origin_id | INTEGER FK | |
| region_id | INTEGER FK | |
| shop_id | INTEGER FK | |
| altitude | INTEGER | Metros |
| quantity_g | INTEGER | Gramos |
| remaining_g | INTEGER | Gramos restantes |
| price_kg | REAL | €/kg |
| purchase_date | TEXT | YYYY-MM-DD |
| roast_date | TEXT | YYYY-MM-DD |
| opened_date | TEXT | YYYY-MM-DD |
| finished_date | TEXT | YYYY-MM-DD |
| rating | INTEGER | 1-5, NULL = sin valorar |
| notes | TEXT | Notas de cata |
| created_at | TEXT | Automático |

### Migración automática

Al arrancar se ejecutan `migrate_v1` a `migrate_v6` — todas idempotentes:

- **v1** — columnas de texto → tablas de referencia con FK
- **v2** — `variety_id`/`process_id` → tablas M2M; enlaza regiones a países
- **v3** — añade leches vegetales M2M con valores por defecto
- **v4** — añade `remaining_g`, inicializa con `quantity_g`
- **v5** — crea índice FTS5 para búsqueda full-text (silencioso si no está disponible)
- **v6** — añade tablas `recipes`, `brews` y sus junctions para historial de preparaciones

Para añadir nuevos cambios de esquema, crear `migrate_v7()` en `schema.py` y llamarla desde `init_db()`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/coffees | Lista con filtros opcionales |
| POST | /api/coffees | Crear café |
| PUT | /api/coffees/:id | Actualizar café |
| DELETE | /api/coffees/:id | Eliminar café |
| POST | /api/coffees/:id/open | Marcar abierto (con fecha) |
| POST | /api/coffees/:id/finish | Marcar terminado hoy |
| POST | /api/coffees/:id/unrate | Quitar valoración |
| PUT | /api/coffees/:id/remaining | Actualizar gramos restantes |
| POST | /api/coffees/:id/consume | Restar una toma (gramos configurables) |
| GET | /api/options | Todos los lookups (para autocomplete) |
| GET | /api/lookup-tables | Lista canónica de tablas de lookup |
| GET | /api/stats | Estadísticas y breakdowns |
| GET | /api/settings | Configuración (gramos por toma) |
| PUT | /api/settings | Guardar configuración |
| GET | /api/lookup/:table | Entradas de una tabla con coffee_count |
| PUT | /api/lookup/:table/:id | Renombrar entrada |
| DELETE | /api/lookup/:table/:id | Eliminar si no está en uso |
| POST | /api/lookup/:table/purge | Eliminar todos los huérfanos |
| GET | /api/auth/status | Estado de sesión (no requiere auth) |
| POST | /api/auth/login | Login con PIN |
| POST | /api/auth/change-pin | Cambiar PIN (requiere PIN actual) |
| GET | /api/coffees/:id/recipe | Obtener receta del café |
| PUT | /api/coffees/:id/recipe | Crear o actualizar receta |
| DELETE | /api/coffees/:id/recipe | Eliminar receta |
| GET | /api/coffees/:id/brews | Historial de preparaciones del café |
| POST | /api/coffees/:id/brews | Registrar preparación |
| GET | /api/brews | Todas las preparaciones (vista global) |
| DELETE | /api/brews/:id | Eliminar preparación |

### Filtros en GET /api/coffees

Query params combinables:

- `status` — `active` / `finished` / `pending` / `unrated`
- `q` — búsqueda full-text (FTS5 si disponible, LIKE como fallback)
- `roaster_id`, `producer_id`, `origin_id`, `region_id`, `process_id`, `variety_id`, `shop_id`
- `limit`, `offset` — paginación

## Funcionalidades

- **Orden recomendado por defecto** — abiertos primero (tueste más antiguo), luego disponibles, luego terminados. Prioriza lo que hay que consumir antes.
- **Lista de cafés** con filtros de estado (abiertos, sin abrir, terminados, sin valorar) y panel de filtros avanzados por cualquier campo de referencia
- **Buscador** con debounce — FTS5 full-text si SQLite lo soporta, LIKE como fallback
- **Seguimiento de café restante** — muestra los gramos que quedan y permite actualizarlos inline desde el detalle
- **Consumo por tomas** — botón "Consumir" resta los gramos configurados; al llegar a 0 ofrece marcar como terminado
- **Gramos por toma configurables** desde el panel de ajustes (por defecto 17 g)
- **Autocompletar** en todos los campos de lookup al añadir/editar — sugiere valores existentes y permite crear nuevos inline
- **Chip input** para variedades, procesos y leches vegetales (multi-selección)
- **Botones rápidos** "Abrir hoy" (con selector de fecha) y "Terminado hoy" directamente desde la tarjeta
- **Aviso de reposo** — indica los días que faltan para las dos semanas desde el tueste
- **Duplicar bolsa** — crea una entrada nueva copiando los datos de producto de una existente
- **Valoración** de 1 a 5 estrellas, con opción de eliminarla
- **Stats** con:
  - Disponibles (bolsas sin abrir), en uso, valoración media, coste medio ponderado por kg
  - Consumo medio normalizado (días para consumir 1 kg)
  - Gráficas de barras por tostador, país de origen, proceso y variedad
  - Calendario Gantt mensual de consumo (con navegación hasta el mes actual)
- **Catálogos** — gestión de tablas de referencia: renombrar entradas (propaga a todos los cafés), eliminar huérfanas individualmente o en bloque
- **Autenticación por PIN** — pantalla de bloqueo con PIN de 4 dígitos, sesión Flask persistente, cambio de PIN desde ajustes
- **PWA** — instalable en móvil/escritorio, con icono y service worker (caché offline de assets y endpoints de lectura)

## Seguridad

- PIN almacenado como SHA-256 en la BD
- Cookie de sesión `HttpOnly` + `SameSite=Strict`
- Clave secreta generada en el primer arranque y persistida en `/data/secret_key`
- Cabeceras CSP, `X-Frame-Options`, `X-Content-Type-Options` y `Referrer-Policy` en todas las respuestas
- Todos los endpoints `/api/*` requieren sesión activa (excepto `/api/auth/status` y `/api/auth/login`)
- Límite de 1 MB por petición

> **Aviso:** esta app está diseñada para uso personal en red local o privada. No está pensada para exponerse directamente a internet sin un proxy inverso con HTTPS y autenticación adicional. El mecanismo de PIN no incluye bloqueo tras varios intentos fallidos.

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE) — puedes usar, modificar y forkear libremente este proyecto para cualquier fin no comercial. No puedes venderlo ni integrarlo en un producto o servicio de pago.
