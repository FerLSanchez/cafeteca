# Cafeteca ☕

Diario personal de cafés de especialidad. Registra compras, consumo, valoraciones y notas de cata. Interfaz web mobile-first, tema oscuro cálido. PWA instalable.

## Arrancar

```bash
docker compose up -d
```

Abre http://localhost:5000 en el móvil o navegador.

Para parar:

```bash
docker compose down
```

## Desarrollo local (sin Docker)

```bash
pip install flask
python app.py
```

Los datos se guardan en `/data/coffee.db`. En local puedes cambiar la variable `DB` en `app.py` para usar una ruta distinta.

## Estructura de ficheros

```
cafeteca/
├── app.py                  # Backend Flask + lógica de BD
├── templates/
│   └── index.html          # Frontend completo (HTML/CSS/JS vanilla)
├── static/
│   ├── manifest.json       # PWA manifest
│   ├── sw.js               # Service worker
│   └── icon-*.png          # Iconos PWA
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
| price_kg | REAL | €/kg |
| purchase_date | TEXT | YYYY-MM-DD |
| roast_date | TEXT | YYYY-MM-DD |
| opened_date | TEXT | YYYY-MM-DD |
| finished_date | TEXT | YYYY-MM-DD |
| rating | INTEGER | 1-5, NULL = sin valorar |
| notes | TEXT | Notas de cata |
| created_at | TEXT | Automático |

### Migración automática

Si la BD tiene las columnas de texto antiguas (`roaster`, `producer`, etc.), al arrancar se migran automáticamente a las tablas de referencia. Para añadir nuevos cambios de esquema, crear `migrate_v3()` y llamarla desde `init_db()`.

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
| GET | /api/options | Todos los lookups (para autocomplete) |
| GET | /api/stats | Estadísticas y breakdowns |
| GET | /api/lookup/:table | Entradas de una tabla con coffee_count |
| PUT | /api/lookup/:table/:id | Renombrar entrada |
| DELETE | /api/lookup/:table/:id | Eliminar si no está en uso |
| POST | /api/lookup/:table/purge | Eliminar todos los huérfanos |
| GET | /api/auth/status | Estado de sesión (no requiere auth) |
| POST | /api/auth/login | Login con PIN |
| POST | /api/auth/change-pin | Cambiar PIN (requiere PIN actual) |

### Filtros en GET /api/coffees

Query params combinables:

- `status` — `active` / `finished` / `pending` / `unrated`
- `q` — búsqueda por nombre (LIKE)
- `roaster_id`, `producer_id`, `origin_id`, `region_id`, `process_id`, `variety_id`, `shop_id`

## Funcionalidades

- **Orden recomendado por defecto** — abiertos primero (tueste más antiguo), luego disponibles (tueste más antiguo), luego terminados. Prioriza lo que hay que consumir antes.
- **Lista de cafés** con filtros de estado (abiertos, sin abrir, terminados, sin valorar) y panel de filtros avanzados por cualquier campo de referencia
- **Buscador** por nombre con debounce
- **Autocompletar** en todos los campos de lookup al añadir/editar — sugiere valores existentes y permite crear nuevos inline
- **Chip input** para variedades, procesos y leches vegetales (multi-selección)
- **Botones rápidos** "Abrir hoy" y "Terminado hoy" directamente desde la tarjeta
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
- **PWA** — instalable en móvil/escritorio, con icono y service worker

## Seguridad

- PIN almacenado como SHA-256 en la BD
- Cookie de sesión `HttpOnly` + `SameSite=Strict`
- Clave secreta generada en el primer arranque y persistida en `/data/secret_key`
- Todos los endpoints `/api/*` requieren sesión activa (excepto `/api/auth/status` y `/api/auth/login`)
