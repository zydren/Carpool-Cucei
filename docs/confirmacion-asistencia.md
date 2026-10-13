# Confirmación de asistencia 20 minutos antes del viaje

Etapa del ciclo de vida que, **20 minutos antes de la hora programada de salida**,
pide confirmación de asistencia al **conductor** y a **cada pasajero con solicitud
aceptada**. Cada persona responde de forma independiente:

| Respuesta   | Significado                                  |
| ----------- | -------------------------------------------- |
| `pending`   | Todavía no responde (estado inicial)         |
| `confirmed` | Confirma que asistirá                        |
| `declined`  | Informa que no asistirá                      |

## 1. Archivos

| Archivo                                                             | Tipo       |
| ------------------------------------------------------------------- | ---------- |
| `supabase/migrations/add_trip_attendance_confirmations.sql`          | **nuevo**  |
| `src/services/tripAttendanceService.ts`                              | **nuevo**  |
| `src/components/TripAttendanceCard.tsx`                              | **nuevo**  |
| `docs/confirmacion-asistencia.md`                                    | **nuevo**  |
| `src/pages/MyTripsPage.tsx`                                          | modificado |
| `src/pages/TripDetailPage.tsx`                                       | modificado |
| `src/services/notificationService.ts`                                | modificado |

## 2. Cómo se calculan los 20 minutos

```
salida = (trips.date + trips.time) AT TIME ZONE 'America/Mexico_City'
ventana = (salida - 20 minutos) <= NOW() < salida
```

* Se calcula **en línea** a partir de `date` (DATE) y `time` (TIME), que existen
  desde `supabase/schema.sql`. Es la misma expresión que usa la columna generada
  `trips.departure_at` (etapa 1) y `public.trip_scheduled_start()` (etapa 2).
* **La migración NO depende de `trips.departure_at`**: si `add_trip_lifecycle.sql`
  no está aplicada, esta etapa sigue funcionando (esa es justamente la causa del
  error `42703: column "departure_at" does not exist` que ya está corregida).
* **Nunca** se usa `route_duration_minutes` para el inicio: la duración estimada de
  la ruta solo la usa el mecanismo de finalización (etapa 2).
* No hay `setTimeout` en React como mecanismo principal.

### Requisitos reales

| Objeto | ¿Necesario? |
| ------ | ----------- |
| `trips.date`, `trips.time` | **Sí** (esquema original) |
| `trip_requests.status` | **Sí** (esquema original) |
| `trips.departure_at` | **No** (etapa 1, opcional) |
| `public.trip_scheduled_start()` | **No** (etapa 2, opcional) |
| `public.is_trip_participant()` | **No** (etapa 2, opcional) |
| `public.notifications` | Opcional: sin ella no hay notificaciones, pero el resto funciona |

## 3. Migración que debes ejecutar manualmente

Supabase → **SQL Editor** → pegar el contenido de
`supabase/migrations/add_trip_attendance_confirmations.sql` → Run.

Es idempotente (se puede ejecutar dos veces) y **no modifica** tablas, vistas, RPC,
triggers ni políticas anteriores. Solo:

1. crea `public.trip_attendance_confirmations`,
2. **amplía** el CHECK `notifications_type_check` con `'attendance_request'`.

### Si ya la ejecutaste y falló con `42703: column "departure_at" does not exist`

Ese error está **corregido**. No necesitas limpiar nada: la migración usa
`BEGIN; … COMMIT;`, así que al fallar, PostgreSQL **revirtió todo** y no quedó ningún
objeto creado. Vuelve a ejecutar el archivo completo desde el principio.

Para confirmarlo antes de reejecutar:

```sql
-- Las cuatro consultas deben devolver 0 filas / false si no quedó nada:
SELECT to_regclass('public.trip_attendance_confirmations');        -- NULL = no existe
SELECT to_regproc('public.respond_trip_attendance(uuid,text)');   -- NULL = no existe
SELECT 1 FROM information_schema.columns
 WHERE table_name = 'trips' AND column_name = 'departure_at';     -- 0 filas = falta etapa 1
SELECT indexname FROM pg_indexes WHERE tablename = 'trips'
  AND indexname LIKE '%departure%';                               -- qué índices hay
```

Si por alguna razón sí quedara la tabla a medias (por ejemplo si ejecutaste el script
por partes fuera de la transacción), borra **solo** los objetos de esta etapa antes de
repetir:

```sql
DROP FUNCTION IF EXISTS public.get_my_trip_attendance_requests();
DROP FUNCTION IF EXISTS public.respond_trip_attendance(uuid, text);
DROP FUNCTION IF EXISTS public.ensure_my_trip_attendance_requests();
DROP FUNCTION IF EXISTS public.dispatch_trip_attendance_requests();
DROP FUNCTION IF EXISTS public.request_trip_attendance_for_trip(uuid);
DROP FUNCTION IF EXISTS public.trip_attendance_lead_interval();
DROP TABLE IF EXISTS public.trip_attendance_confirmations;
```

### Objetos creados

| Objeto                                    | Permiso                                                 |
| ----------------------------------------- | ------------------------------------------------------- |
| `trip_attendance_confirmations` (tabla)   | `SELECT` propio (RLS `user_id = auth.uid()`); **sin** INSERT/UPDATE/DELETE |
| `trip_attendance_lead_interval()`         | `anon`, `authenticated`                                 |
| `request_trip_attendance_for_trip(UUID)`  | interno (sin EXECUTE para la API)                       |
| `dispatch_trip_attendance_requests()`     | `postgres` (lo usa pg_cron)                             |
| `ensure_my_trip_attendance_requests()`    | `authenticated` (respaldo perezoso)                     |
| `respond_trip_attendance(UUID, TEXT)`     | `authenticated` (única vía de escritura)                |
| `get_my_trip_attendance_requests()`       | `authenticated` (lee solo mis filas)                    |

## 4. Programación de las notificaciones

1. **Principal:** si la extensión `pg_cron` está habilitada, la migración programa
   el trabajo `carpool_attendance_requests` cada 5 minutos con
   `SELECT public.dispatch_trip_attendance_requests();`. No depende de que nadie
   tenga la página abierta.
2. **Respaldo (funciona sin cron desde ya):** al abrir *Mis viajes* o el detalle de
   un viaje, el cliente llama a `ensure_my_trip_attendance_requests()`, que genera
   las solicitudes de **mis** viajes que ya están en ventana. Mismo patrón que
   `reap_my_trip_completions()` de la etapa 2.
3. **Alternativas** si no hay `pg_cron`: un cron externo (GitHub Actions/VPS) o una
   Edge Function con `service_role` que invoque el mismo RPC.

Para habilitar `pg_cron`: *Database → Extensions → pg_cron* y volver a ejecutar la
migración (el bloque de programación es idempotente).

## 5. Cómo se evitan los duplicados

* Filas: `UNIQUE (trip_id, user_id)` + `ON CONFLICT DO NOTHING`.
* Notificaciones: solo se insertan para las filas **recién creadas** (`RETURNING`)
  y además se comprueba `NOT EXISTS` una notificación `attendance_request` previa
  para ese `(viaje, usuario)`.
* Respuestas: `INSERT ... ON CONFLICT (trip_id, user_id) DO UPDATE` sobre mi fila.

## 6. Qué NO hace esta etapa (a propósito)

* No cambia `trips.status` (nada de `in_progress` automático).
* No cancela viajes ni elimina solicitudes si alguien declina o no responde.
* No libera asientos.
* No pide permisos de geolocalización ni hace seguimiento GPS.
* No hay notificaciones push: se reutiliza `public.notifications` (dentro de la app).

## 7. Cómo probarlo

1. Aplica la migración.
2. Crea un viaje con salida dentro de 20 minutos (o ejecuta a mano
   `SELECT public.dispatch_trip_attendance_requests();` con un viaje en ventana).
3. **Conductor**: en *Mis viajes → Próximos* aparece la tarjeta «Confirma tu
   asistencia». Pulsa **Confirmar asistencia**.
4. **Pasajero aceptado**: entra con otra cuenta; debe aparecerle su propia tarjeta y
   poder responder **sin afectar** la respuesta del conductor.
5. **Pasajero NO aceptado**: no recibe notificación ni tarjeta.
6. **Recarga la página**: la respuesta sigue ahí (está en Supabase).
7. Pulsa **No podré asistir**: el viaje continúa, la solicitud aceptada se mantiene y
   no se libera el asiento.
8. Cancela el viaje y vuelve a ejecutar el despachador: no genera solicitudes.
9. Ejecuta el despachador varias veces: el conteo de filas y de notificaciones no
   aumenta (idempotencia).
10. Intenta responder por otra persona (por API, con tu JWT): el RPC lo rechaza.

### Comprobaciones SQL útiles

```sql
-- Viajes en ventana ahora mismo
SELECT id, origin, destination, date, time FROM public.trips
WHERE status = 'active'
  AND (date + time) AT TIME ZONE 'America/Mexico_City'
        - public.trip_attendance_lead_interval() <= NOW()
  AND (date + time) AT TIME ZONE 'America/Mexico_City' > NOW();

-- Solicitudes generadas
SELECT trip_id, user_id, response, requested_at, responded_at
FROM public.trip_attendance_confirmations ORDER BY requested_at DESC;

-- Notificaciones del nuevo tipo
SELECT COUNT(*) FROM public.notifications WHERE type = 'attendance_request';

-- Trabajo programado (si pg_cron está activo)
SELECT jobname, schedule, active FROM cron.job
WHERE jobname = 'carpool_attendance_requests';
```

## 8. Trabajo pendiente (GPS, etapa futura)

* Notificaciones **push** para quien tenga el navegador cerrado (service worker + Web
  Push). Aquí solo hay notificaciones dentro de la aplicación.
* Que el **conductor** vea el estado de asistencia de sus pasajeros: exigirá una
  política RLS nueva de lectura para `driver_id` (hoy cada quien ve solo su fila).
* Consecuencias de `declined` (liberar asiento, reevaluar el viaje) y del conductor
  que no confirma: requieren decidir la política de cancelaciones.
* Seguimiento GPS en tiempo real: **independiente** de esta confirmación.
