# CLAUDE.md — Cafeteca

Contexto para continuar el desarrollo de esta aplicación en Claude Code.

## Qué es

App web personal para registrar cafés de especialidad. Flask + SQLite + HTML/CSS/JS vanilla. Mobile-first, tema oscuro cálido. Corre en Docker.

## Ficheros relevantes

- `app.py` — app factory Flask: registra blueprints, secret key, security headers, PWA routes
- `schema.py` — esquema de BD, init y migraciones (`init_db()`, `migrate_v1()` … `migrate_v7()`)
- `models.py` — helpers de datos: `row_to_coffee()`, `COFFEE_SELECT`, `resolve_ids()`, `set_m2m()`
- `db.py` — conexión SQLite y variable `DB`
- `lookup_config.py` — constantes `LOOKUP_TABLES`, `LOOKUP_FK`, `JUNCTION_TABLES` y `get_or_create()`
- `blueprints/` — endpoints REST por dominio: `auth`, `coffees`, `stats`, `settings`, `lookup`, `brews`
- `templates/index.html` — todo el frontend en un único fichero (HTML + CSS + JS)
- `docker-compose.yml` — monta `./data` como volumen para persistir la BD
- `Dockerfile` — imagen Python 3.12-slim, solo depende de Flask
- `static/js/i18n.js` — helper de internacionalización: `t()`, `initI18n()`, `applyI18n()`, `changeLang()`
- `static/i18n/es.json` — todas las cadenas de la UI en español; `en.json` — traducción inglesa

## Arquitectura de datos

SQLite con 8 tablas de referencia normalizadas (roasters, producers, varieties, origins, regions, processes, shops, milk_types).

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
- **`JUNCTION_TABLES`** — relación M2M vía tabla de unión: `varieties` → `coffee_varieties`, `processes` → `coffee_processes`, `milk_types` → `coffee_milk_types`

Los endpoints de lookup (`/api/lookup/<table>`) y las funciones de conteo/borrado/purga distinguen ambas categorías internamente.

### Helpers clave

- `get_or_create(conn, table, name)` — en `lookup_config.py`; crea o reutiliza una entrada en cualquier lookup table
- `resolve_ids(conn, data)` — en `models.py`; resuelve strings de lookup a IDs y auto-vincula región→país
- `set_m2m(conn, coffee_id, values, ...)` — en `models.py`; reemplaza todas las relaciones M2M de un café
- `row_to_coffee(row)` — en `models.py`; convierte una fila SQLite a dict con arrays `varieties` y `processes`
- `COFFEE_SELECT` — en `models.py`; query base con subconsultas GROUP_CONCAT para variedades y procesos

### Formato del API

- Campos de lookup simples: el frontend envía strings (`roaster: "Ineffable"`), el backend los resuelve con `resolve_ids()`
- Variedades y procesos: el frontend envía **arrays** (`varieties: ["Heirloom", "SL28"]`), el backend los gestiona con `set_m2m()`
- Las respuestas incluyen `varieties: [...]`, `variety_ids: [...]`, `processes: [...]`, `process_ids: [...]`
- `/api/options` devuelve regiones con `origin_id` para que el frontend pueda filtrar por país
- `/api/stats` devuelve además `current_month` (`consumed_g`, `brews_count`, `avg_rating`) y `active_bags` (bolsas abiertas o terminadas en el mes actual, con `opened_date`/`finished_date`) para el hero y el Gantt de stats

### Errores de API con clave i18n

Todas las respuestas de error incluyen `error_key` (y opcionalmente `error_key_params`) para que el frontend pueda mostrar el mensaje traducido:

```python
# En cualquier blueprint
return jsonify({'error': 'PIN incorrecto', 'error_key': 'error.auth.wrong_pin'}), 401

# Con parámetros de interpolación
return jsonify({
    'error': 'En uso por 3 cafés',
    'error_key': 'error.lookup.in_use',
    'error_key_params': {'count': 3}
}), 409
```

El frontend en `api.js` comprueba `data.error_key` primero y usa `t(error_key, params)` para traducir.

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
- Añadir un nuevo cambio de esquema: crear `migrate_v8()` en `schema.py` y llamarla desde `init_db()` (la última es `migrate_v7`: añade `time_s INTEGER` a `recipes` y `brews`)
- `SETTING_LOW_STOCK_THRESHOLD` — umbral configurable (1-50, default 5) en `schema.py`; cuando `floor(remaining_g / grams_per_shot) <= threshold` se muestra ⚠️ en la ficha
- Registrar un brew descuenta `dose_g` de `remaining_g` del café si está abierto y tiene restante definido (se descuenta solo al crear, no al editar ni borrar)
- **Pulsar "Consumir"** (`POST /api/coffees/:id/consume`) también crea un registro de brew automáticamente con los datos de la receta del café si existe, o solo con `dose_g = grams_per_shot`. El descuento de `remaining_g` lo hace el propio endpoint de consume; el brew creado **no** vuelve a descontarlo.
- **`GET /api/brews`** soporta paginación vía `?limit=20&offset=0`; devuelve `{brews, total, has_more}`. La pestaña de prepas usa scroll infinito cargando 20 a la vez.
- **`DELETE /api/brews/purge`** (body JSON `{months: N}`) elimina preparaciones con `brew_date` anterior a N meses; devuelve `{ok, deleted}`. Configurable desde el modal de Ajustes.
- Todos los endpoints de lookup comprueban que `table` esté en `LOOKUP_TABLES` antes de ejecutar
- Las fechas se guardan como TEXT en formato `YYYY-MM-DD`
- `rating NULL` = sin valorar (nunca se guarda 0)
- El frontend define `LOOKUP_TABLES` como array JS — se sincroniza automáticamente desde `/api/options`

## Frontend — convenciones JS

- **Chip input** para variedades y procesos: estado en `selectedVarieties` / `selectedProcesses` (arrays), gestionado por `addChip()`, `removeChip()`, `renderChips()`
- `CHIP_FIELDS` — mapa que conecta tabla lookup con su estado y elementos DOM de chips
- **Cascada región→país**: `onOriginChange()` actualiza el hint de región en el formulario; `onFilterOriginChange()` filtra el desplegable de región en el panel de filtros avanzados
- `renderAC()` filtra automáticamente los chips ya seleccionados y las regiones por país
- `consumeShot(id)` — función global en `list.js` que llama a `POST /api/coffees/:id/consume` y refresca la lista; usada desde el `.consume-block` inline en tarjetas de bolsas abiertas. El endpoint además crea un brew automáticamente.
- `purgeOldBrews()` — en `form.js`; muestra confirmación y llama `DELETE /api/brews/purge` con los meses seleccionados en `#s-purge-months`
- **Scroll infinito en pestaña Prepas**: `loadBrews(reset=true)` en `brews.js`; carga 20 registros por página usando IntersectionObserver sobre `#brews-sentinel`
- **Vista compacta**: `toggleCompactView()` alterna `compactList` (boolean en `state.js`), persiste en `localStorage('compactList')`, y llama `renderList()`; `renderCompactCard(c)` en `list.js`
- **time_s (tiempo de extracción)**: campo opcional en recetas y brews; `fmtFlow(yld, time_s)` en `brews.js` calcula el flujo en g/s; el ratio y flujo se muestran en `#r-ratio-display` / `#b-ratio-display`

## Internacionalización (i18n)

La UI está internacionalizada mediante un sistema de traducción JSON sin dependencias externas.

### Ficheros

- `static/js/i18n.js` — debe cargarse **primero** (antes que `state.js` y cualquier otro JS)
- `static/i18n/es.json` — cadenas en español (idioma por defecto)
- `static/i18n/en.json` — cadenas en inglés (ya implementado)
- `static/i18n/<lang>.json` — añadir este fichero para soportar un nuevo idioma

### API de traducción

```javascript
// Traducción simple
t('nav.title')                           // → "Cafeteca"

// Con interpolación de variables
t('list.days_open_tag', {days: 3, s: 's'})  // → "📅 3 días abierto"

// Aplicar atributos data-i18n al DOM (llamar tras initI18n)
applyI18n()

// Cambiar idioma (guarda en localStorage y recarga la página)
changeLang('en')
```

### Atributos HTML

```html
<span data-i18n="nav.title">Cafeteca</span>
<input data-i18n-placeholder="nav.search_placeholder">
<button data-i18n-title="filter.btn_title">…</button>
```

`applyI18n()` recorre el DOM y rellena `textContent`, `placeholder` y `title` respectivamente.

### Convención de claves

Separador `.`, grupo primero en snake_case:

| Grupo | Uso |
|-------|-----|
| `nav.*` | Barra de navegación |
| `filter.*` | Panel de filtros y pills de estado |
| `sort.*` | Opciones del dropdown de ordenación |
| `form.*` | Campos y secciones del formulario de café |
| `modal.*` | Títulos de modales |
| `detail.*` | Vista de detalle de un café |
| `status.*` | Estados del café (abierto, terminado, sin abrir) |
| `catalog.*` | Tabla de catálogo de lookup tables |
| `month.*` | Nombres de los 12 meses |
| `stats.*` | Página de estadísticas |
| `brew.*` | Preparaciones y recetas |
| `settings.*` | Ajustes y PIN |
| `list.*` | Tarjetas de la lista principal |
| `confirm.*` | Diálogos de confirmación |
| `toast.*` | Mensajes de notificación |
| `validation.*` | Errores de validación en frontend |
| `error.*` | Errores del backend (coinciden con `error_key`) |

Para pluralización se usa la variable `{s}`: el JS pasa `s: count !== 1 ? 's' : ''`.

### Constantes convertidas a funciones

`MONTH_NAMES` y `CATALOG_LABELS` se eliminaron de `state.js` y se convirtieron en funciones que llaman a `t()`:

```javascript
getMonthNames()     // devuelve array de 12 nombres del mes traducidos
getCatalogLabels()  // devuelve objeto {roasters, producers, ...} traducido
```

### Añadir un nuevo idioma

1. Crear `static/i18n/<lang>.json` con las mismas claves que `es.json`
2. Añadir `<option value="<lang>">Nombre</option>` al `<select id="lang-select">` en `index.html`
3. El selector de idioma está en el modal ⚙️ Ajustes; el idioma persiste en `localStorage`

### Inicialización

En `init.js`, `startup()` llama `await initI18n()` y luego `applyI18n()` antes de cualquier otra operación. Si el fichero de idioma no carga, hace fallback automático a `es.json`.

## Estado actual

La aplicación está en uso con datos reales. Cualquier cambio de esquema debe ir acompañado de una nueva función `migrate_vN()` llamada desde `init_db()`.

La UI está completamente internacionalizada (i18n). Todas las cadenas estáticas pasan por `t()` y están definidas en `static/i18n/es.json`. Los datos introducidos por el usuario (nombres de cafés, tostadores, etc.) no se traducen.

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

## Tests

```bash
pip install -r requirements-test.txt
pytest                         # suite completa
pytest tests/test_brews.py     # un módulo específico
```

Los tests usan una BD SQLite en memoria. `conftest.py` provee el fixture `client`.

## Posibles mejoras pendientes

- Exportar/importar datos (CSV o JSON)
- Foto de la bolsa del café
- Comparar dos cafés lado a lado
- Tiempo medio de consumo por café (días entre apertura y fin)
- Filtro por rango de precio o valoración mínima
