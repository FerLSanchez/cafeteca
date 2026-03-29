# Cafeteca ☕

Diario personal de cafés de especialidad. Registra compras, consumo, valoraciones y notas de cata. Interfaz web mobile-first, tema oscuro cálido.

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
| varieties | variety_id |
| origins | origin_id |
| regions | region_id |
| processes | process_id |
| shops | shop_id |

**Tabla `coffees`:**

| Campo | Tipo | Notas |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT | Obligatorio |
| roaster_id | INTEGER FK | |
| producer_id | INTEGER FK | |
| variety_id | INTEGER FK | |
| origin_id | INTEGER FK | |
| region_id | INTEGER FK | |
| process_id | INTEGER FK | |
| shop_id | INTEGER FK | |
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

Si la BD tiene las columnas de texto antiguas (`roaster`, `producer`, etc.), al arrancar se migran automáticamente a las tablas de referencia y se eliminan las columnas viejas. Compatible con SQLite ≥ 3.35 y versiones anteriores (rebuild de tabla).

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | /api/coffees | Lista con filtros opcionales |
| POST | /api/coffees | Crear café |
| PUT | /api/coffees/:id | Actualizar café |
| DELETE | /api/coffees/:id | Eliminar café |
| POST | /api/coffees/:id/open | Marcar abierto hoy |
| POST | /api/coffees/:id/finish | Marcar terminado hoy |
| POST | /api/coffees/:id/unrate | Quitar valoración |
| GET | /api/options | Todos los lookups (para autocomplete) |
| GET | /api/stats | Estadísticas y breakdowns |
| GET | /api/lookup/:table | Entradas de una tabla con coffee_count |
| PUT | /api/lookup/:table/:id | Renombrar entrada |
| DELETE | /api/lookup/:table/:id | Eliminar si no está en uso |
| POST | /api/lookup/:table/purge | Eliminar todos los huérfanos |

### Filtros en GET /api/coffees

Query params combinables:

- `status` — `active` / `finished` / `pending` / `unrated`
- `q` — búsqueda por nombre (LIKE)
- `roaster_id`, `producer_id`, `origin_id`, `region_id`, `process_id`, `variety_id`, `shop_id`

## Funcionalidades

- **Lista de cafés** con filtros de estado y panel de filtros avanzados por cualquier campo de referencia
- **Buscador** por nombre con debounce
- **Autocompletar** en todos los campos de lookup al añadir/editar — sugiere valores existentes y permite crear nuevos inline
- **Botones rápidos** "Abrir hoy" y "Terminado hoy" directamente desde la tarjeta
- **Valoración** de 1 a 5 estrellas, con opción de eliminarla
- **Stats** con totales, valoración media, gasto total y gráficas de barras por tostador, origen y proceso
- **Catálogos** — gestión de tablas de referencia: renombrar entradas (propaga a todos los cafés), eliminar huérfanas individualmente o en bloque
