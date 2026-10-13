# GPS en tiempo real — Carpool Universitario

Documentación de la etapa de seguimiento GPS. Cubre (1) la **prueba de GPS** del
perfil y (2) el **seguimiento compartido durante un viaje en curso**.

> Todo lo que depende de la base de datos (tabla, RLS, RPC y Realtime) requiere
> aplicar la migración `supabase/migrations/add_trip_live_locations.sql` en el SQL
> Editor de Supabase. **No está aplicada hasta que la ejecutes y verifiques.** Sin
> ella, la app sigue funcionando: la prueba de GPS del perfil trabaja igual (no
> toca Supabase) y el seguimiento del viaje muestra un aviso discreto en lugar de
> errores.

---

## 1. Prueba de GPS (perfil)

En **`/perfil`** hay una sección **«Ubicación»** con el botón **«Probar GPS»**
(icono `LocateFixed`). Al abrirlo:

- Explica que el navegador pedirá permiso de ubicación.
- Usa `navigator.geolocation.watchPosition()` (actualizaciones continuas, no una
  sola lectura).
- Dibuja un mapa Leaflet (mismo stack que el resto de la app, tiles de
  OpenStreetMap) con un marcador que se mueve con cada lectura.
- Muestra latitud, longitud, precisión en metros y la hora de la última lectura.
- Estado del GPS: sin iniciar / esperando permiso / buscando / activo / error.
- Botón **«Detener GPS»** (llama a `clearWatch`) y botón para recentrar el mapa.
- Si el usuario deniega el permiso, muestra pasos claros para habilitarlo.

**Esta prueba nunca publica nada en Supabase.** Es solo para el dispositivo.

Archivos: `src/components/GpsTestPanel.tsx`, `src/hooks/useGeolocationWatcher.ts`,
`src/services/geolocationService.ts`.

---

## 2. Seguimiento compartido (viaje en curso)

Se muestra en el detalle del viaje (`/mis-viajes/:tripId`) **solo cuando el ciclo
de vida del viaje está `in_progress`**. No aparece en viajes finalizados ni
cancelados.

### Activación
- **Consentimiento explícito y por persona**: hay que pulsar «Compartir mi
  ubicación». La confirmación de asistencia **no** activa el GPS.
- El conductor, al compartir, marca además el viaje como `in_progress`
  (idempotente; no completa ni cancela nada).
- «Dejar de compartir» detiene el watcher y marca el consentimiento en `false`
  (reversible). No borra la última lectura: los demás ven «dejó de compartir».

### Cómo se propaga (sin recargar)
- Cada lectura propia se publica con el RPC `upsert_my_trip_location`.
- La lista de participantes se refresca por **Supabase Realtime**
  (`subscribeToTripLiveLocations`), con RLS: cada quien solo recibe los viajes en
  los que participa.
- El mapa reutiliza `LiveLocationMap` (mismo componente de la prueba de GPS):
  color distinto para conductor y pasajeros, y antigüedad de cada lectura.

### Seguridad
- El frontend **no** escribe la tabla directamente (sin INSERT/UPDATE/DELETE para
  la API). Única vía de escritura: los RPC `SECURITY DEFINER`, que validan en la
  base de datos sesión (`auth.uid()`), estado `in_progress` y participación.
- RLS de lectura: solo los participantes del viaje ven esas ubicaciones.
- Nadie puede publicar la ubicación de otro participante.

Archivos: `src/components/TripLiveTracking.tsx`,
`src/services/tripLocationService.ts`.

---

## 3. Migración que debes ejecutar (pendiente)

`supabase/migrations/add_trip_live_locations.sql`:

1. Crea la tabla `public.trip_live_locations` (una fila por viaje y usuario; sin
   historial) con `UNIQUE(trip_id, user_id)` y validación de rangos.
2. Habilita RLS con **una sola** política de lectura para participantes y
   **revoca** INSERT/UPDATE/DELETE (solo RPC escribe).
3. Crea los RPC: `start_my_trip`, `upsert_my_trip_location`,
   `set_my_trip_location_sharing`, `get_trip_live_locations`,
   `clear_trip_live_locations`.
4. Añade la tabla a la publicación Realtime `supabase_realtime`.

Aplícala en **Supabase → SQL Editor** y confirma que termine con `COMMIT`. Es
idempotente. Después verifica en **Database → Replication** que aparezca
`trip_live_locations` en `supabase_realtime`.

---

## 4. Limitaciones reales (a propósito, no simuladas)

- **Sin GPS en segundo plano.** Los navegadores SUSPENDEN la geolocalización
  cuando la pestaña pasa a segundo plano, el dispositivo entra en ahorro de
  energía o se cierra la página. El seguimiento funciona con la app visible. No se
  promete ni se simula lo contrario.
- **Una sola última posición por persona** (no hay historial de ruta).
- **Vista del conductor.** La pantalla de detalle usa `getTripsByDriver()`, así
  que hoy la abre el conductor. Los pasajeros aceptados pueden compartir y ver a
  los demás si se les habilita la misma pantalla (los RPC y la RLS ya lo permiten);
  falta exponer esa vista para pasajeros. Queda como trabajo futuro documentado.
- **No hay push cuando la app está cerrada.** Requeriría service worker + Web
  Push; fuera de esta etapa.

---

## 5. Cómo probar

1. `/perfil` → «Probar GPS»: concede el permiso y muévete; el marcador debe
   desplazarse sin recargar. Pulsa «Detener GPS» y comprueba que deja de
   actualizar. Deniega el permiso y verifica las instrucciones.
2. Con un viaje en curso (`in_progress`): abre su detalle, pulsa «Compartir mi
   ubicación» y confirma que apareces en la lista y el mapa. Desde otro
   dispositivo (mismo viaje, otro participante) repítelo y comprueba que se ven
   mutuamente por Realtime. Pulsa «Dejar de compartir» y verifica el estado.
3. Prueba de acceso: con un usuario que **no** participa, `get_trip_live_locations`
   debe fallar y la lectura directa a la tabla debe devolver 0 filas (RLS).
4. Al completar o cancelar el viaje, llama `clear_trip_live_locations('<id>')`:
   el conteo de ubicaciones de ese viaje debe quedar en 0.

> La prueba de dos dispositivos en simultáneo **no** se ejecutó aquí (no hay dos
> dispositivos ni una base real disponibles); se validó la lógica del servicio y
> las comprobaciones de TypeScript/ESLint/build.
