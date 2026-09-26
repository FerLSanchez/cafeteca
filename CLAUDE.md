# CLAUDE.md — Cafeteca

Contexto para continuar el desarrollo de esta aplicación en Claude Code.

## Qué es

App web personal para registrar cafés de especialidad. Flask + SQLite + HTML/CSS/JS vanilla. Mobile-first, tema oscuro cálido. Corre en Docker.

## Ficheros relevantes

- `app.py` — app factory Flask: registra blueprints, security headers, PWA routes
- `schema.py` — esquema de BD, init y migraciones (`init_db()`, `migrate_v1()` … `migrate_v9()`)
- `models.py` — helpers de datos: `row_to_coffee()`, `COFFEE_SELECT`, `resolve_ids()`, `set_m2m()`
- `db.py` — conexión SQLite y variable `DB` (la BD usa `journal_mode=WAL`, activado en `init_db()`)
- `lookup_config.py` — constantes `LOOKUP_TABLES`, `LOOKUP_FK`, `JUNCTION_TABLES` y `get_or_create()`
- `blueprints/` — endpoints REST por dominio: `coffees`, `stats`, `settings`, `lookup`, `brews`
- `templates/index.html` — todo el frontend en un único fichero (HTML + CSS + JS)
- `docker-compose.yml` — monta `./data` como volumen para persistir la BD
- `Dockerfile` — imagen Python 3.14-slim, depende de Flask + gunicorn
- `static/js/i18n.js` — helper de internacionalización: `t()`, `initI18n()`, `applyI18n()`, `changeLang()`
- `static/js/scale.js` — báscula Bookoo por Web Bluetooth: `parseScalePacket()` (puro, testeado con node), `scaleConnect()`/`scaleTare()`/`scaleDisconnect()`, bus `scale.bus` y la captura de tramas
- `static/js/scale-analysis.js` — puro (testeado con node): `DoseTracker` (congela la dosis al levantar el recipiente), `ShotTracker` (el timer 0→>0 arranca, vuelve a 0 = fin), `analyzeShot()` (métricas de flujo §5.4)
- `static/js/scale-ui.js` — chip ⚖️ del nav, ⚖️ de dosis y "⏱ Shot con báscula" en el modal de brew, `createShotView()` (curva en vivo + resumen) y la página de prueba (`modal-scale`, desde Ajustes)
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
return jsonify({'error': 'Ya existe una entrada con ese nombre', 'error_key': 'error.lookup.duplicate_name'}), 409

# Con parámetros de interpolación
return jsonify({
    'error': 'En uso por 3 cafés',
    'error_key': 'error.lookup.in_use',
    'error_key_params': {'count': 3}
}), 409
```

El frontend en `api.js` comprueba `data.error_key` primero y usa `t(error_key, params)` para traducir.

## Autenticación (Authelia vía NPM)

La app **no tiene autenticación propia**: `cafeteca.fersanchez.com` está detrás de Authelia (forward-auth en Nginx Proxy Manager, mismo patrón que `bodega.fersanchez.com`). Flask confía en que toda petición que le llega ya está autenticada.

- **NPM** (proxy host 42, pestaña *Advanced*; NPM guarda la config en su MySQL y regenera `/data/nginxproxymanager/data/nginx/proxy_host/42.conf` al guardar — no editar el `.conf` a mano): `auth_request` → `http://127.0.0.1:9092/api/authz/auth-request`. Sin sesión, las navegaciones reciben 302 a `auth.fersanchez.com`; **`/api/` recibe un 401 sin redirección** (un `fetch()` no puede seguir el redirect cross-origin). Sin auth: `/sw.js`, `/manifest.json`, `/static/`. Tras cada guardado, comprobar que `42.conf` existe y `nginx -t` pasa (un error en *Advanced* borra el server block entero). **Nunca `map` en *Advanced*** (solo válido en `http`, tumbó bodega).
- **Authelia** (`/data/authelia/config/configuration.yml`): regla `cafeteca.fersanchez.com` → `one_factor`, `group:admins`.
- **Invariante de seguridad**: `docker-compose.yml` publica `127.0.0.1:5323`, nunca `5323`. Con un bind público cualquiera en la LAN entraría sin login.
- **Frontend**: `api()` en `api.js` recarga la página ante un 401 (sesión de Authelia caducada → la navegación lleva al login). `sw.js` sirve las navegaciones *network-first* (el shell cacheado es solo fallback offline, si no una sesión caducada nunca llegaría al login) y precachea con `Promise.allSettled` ignorando respuestas redirigidas.
- El antiguo PIN se eliminó en `migrate_v8` (borra `pin_hash` de `settings`).

## Convenciones importantes

- La BD vive en `/data/coffee.db` (variable `DB` en `db.py`)
- `init_db()` se llama al arrancar y es idempotente — incluye todas las migraciones
- Hay dos fases de migración: `migrate_v1()` (texto→FK, legado) y `migrate_v2()` (FK→M2M + link región-país)
- Añadir un nuevo cambio de esquema: crear `migrate_v10()` en `schema.py` y llamarla desde `init_db()` (la última es `migrate_v9`: `brews.shot_metrics` JSON y `recipes.target_flow`)
- `SETTING_LOW_STOCK_THRESHOLD` — umbral configurable (1-50, default 5) en `schema.py`; cuando `floor(remaining_g / grams_per_shot) <= threshold` se muestra ⚠️ en la ficha
- Registrar un brew descuenta `dose_g` de `remaining_g` del café si está abierto y tiene restante definido (se descuenta solo al crear, no al editar ni borrar)
- **Pulsar "Consumir"** (`POST /api/coffees/:id/consume`) devuelve 409 si el café está terminado (`error.coffee.consume_finished`) o no tiene `remaining_g` (`error.coffee.consume_no_stock`). También crea un registro de brew automáticamente con los datos de la receta del café si existe, o solo con `dose_g = grams_per_shot`. El descuento de `remaining_g` lo hace el propio endpoint de consume; el brew creado **no** vuelve a descontarlo.
- **Fechas del cliente**: `open`, `finish` y `consume` aceptan un body opcional `{date: 'YYYY-MM-DD'}`; el frontend envía siempre `todayLocal()` (en `utils.js`) para evitar el desfase UTC del servidor. **No usar `toISOString()` para la fecha de hoy.**
- **`PUT /api/coffees/:id` y `PUT /api/brews/:id` son actualizaciones parciales**: solo se modifican las claves presentes en el body; enviar `null` explícito borra el campo.
- **Báscula**: los brews aceptan `shot_metrics` (objeto JSON con las claves de `SHOT_METRIC_KEYS` en `models.py`; se guarda como TEXT y se devuelve parseado) y las recetas `target_flow` (g/s, 0.1–10). Ajuste `flow_tolerance` (0.05–1, default 0.2) en `/api/settings`.
- Brews y recetas se validan con `validate_brew(data, recipe=False)` en `models.py` (tipos y rangos de `dose_g`, `yield_g`, `time_s`, `grind`, `temp_c`, `rating`, `brew_date`); los errores devuelven 400 con `error_key`.
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
- `MODAL_ON_CLOSE[id]` (en `api.js`) — limpieza que `closeModal(id)` ejecuta siempre (botón, overlay o código); la usa la báscula para soltar suscripciones y el wake lock
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
| `settings.*` | Ajustes |
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
node --test tests/js/*.test.js # tests JS (parser, detectores y análisis de la báscula)
# E2E báscula (manual, necesita playwright y la app corriendo):
# BASE_URL=http://localhost:5323 node tests/e2e/scale-flow.e2e.js
```

Los tests usan una BD SQLite en memoria. `conftest.py` provee el fixture `client`.

## Posibles mejoras pendientes

Revisión completa (UX, ingeniería, producto) con backlog codificado: `docs/REVIEW-2026-09.md`.

- **Siguiente feature: báscula Bookoo Themis Mini por Web Bluetooth** (PM-14): la dosis en modo normal → campo "Café (g)", y el rendimiento + tiempo del shot en modo auto. La spec completa está en `docs/features/bookoo-scale.md`; F0 y F1 están hechas (hallazgos y notas de implementación en §8 de la spec). Falta validar F1 en el Pixel con shots reales y después F2 (mostrar métricas y tendencias). La UX del modo auto (análisis de flujo por fases, métricas guardadas, sin guardar la curva) está acordada en §5.4 de la spec.

- Exportar/importar datos (CSV o JSON)
- Foto de la bolsa del café
- Comparar dos cafés lado a lado
- Tiempo medio de consumo por café (días entre apertura y fin)
- Filtro por rango de precio o valoración mínima
