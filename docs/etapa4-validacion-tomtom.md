# Etapa 4 — Configuración y validación de TomTom (Vercel preview)

> Estado: fix de la firma del export **APLICADO** y validado localmente
> (`scripts/etapa4EndpointSmoke.mjs`: 13/13 reproduciendo el defecto antes del
> fix; 11/11 tras el fix con la Fase 1 ya no aplicable; GET/POST terminan con
> respuesta HTTP). La solicitud REAL a TomTom y la revisión en navegador
> siguen **pendientes** de configurar `TOMTOM_API_KEY` (no existe en este
> entorno ni en el repositorio; no se ha inventado ninguna credencial).
> Fecha de ejecución local: 2026-10-14.

## 1. Hallazgo crítico: firma del handler de `api/route.ts`

Vercel invoca un default export **plano** de una función Node con la firma
clásica `(req, res)`, NO con un web `Request`. Lo confirman el código fuente
publicado de `@vercel/node` (`bundling-handler.js`,
`serverless-functions/serverless-handler.mts`) y la propia detección
`isNodeEntrypoint` (`build-utils/src/node-entrypoint.ts`): solo se trata como
*web handler* un export con métodos HTTP con nombre (`export const POST`) o con
`.fetch`. Con la forma actual (`export default async function handler(request:
Request)`), en preview/producción la petición **no recibe respuesta** (el
`Response` devuelto se ignora y `res` nunca se cierra) hasta que la plataforma
la corta. Reproducido localmente en la Fase 1 del smoke: GET y POST no
responden (timeout). El cliente, además, aborta a los 15 s y cae a OSRM, así
que el fallo sería silencioso.

**Fix propuesto (pendiente de autorización)** — cambiar la forma del export a
una documentada por Vercel (`export default { fetch }` o `export const POST`)
manteniendo la lógica intacta. No se ha modificado ningún archivo de las
Etapas 0–3.

## 2. Variables de entorno (sin valores)

| Variable | Dónde | Estado actual | Notas |
|---|---|---|---|
| `TOMTOM_API_KEY` | Solo servidor (Vercel) | Reportada como creada en Vercel (su valor no se imprime ni se versiona) | Sin prefijo `VITE_` ni `ROUTING_`: Vite NUNCA la inlinea en el bundle. |
| `ROUTING_PROVIDER=tomtom` | Servidor; se inyecta en el **build** y Vite la expone al cliente (prefijo `ROUTING_` vía `envPrefix` en `vite.config.ts`) | Reportada como creada en Vercel (requiere redeploy para aplicarse al bundle) | El valor no es un secreto (solo activa el intento del proxy). Alias heredado `VITE_ROUTING_PROVIDER` sigue admitido. Sin la bandera el cliente usa OSRM siempre (apagado seguro por defecto). |

Cómo configurarlas:

- **Vercel Preview**: proyecto → Settings → Environment Variables → ambas con
  *Environment* = Preview (NO Production; la activación en producción es una
  etapa posterior con autorización). `ROUTING_PROVIDER` se inyecta **en el
  build**: tras cambiarla hay que redeployar la preview.
- **Local**: añadir al archivo `.env` de la raíz (ya está en `.gitignore`):
  `TOMTOM_API_KEY=...` y `ROUTING_PROVIDER=tomtom`. `vite dev` expone al
  cliente las `VITE_*` y las `ROUTING_*` (ambos prefijos en `envPrefix`); la
  clave del servidor solo la usan los scripts de smoke o `vercel dev`. Nota:
  en `vite dev` NO existe `/api/route` (es función de Vercel), así que en
  local el cliente cae a OSRM.
- **Caveat de `envPrefix: ['VITE_', 'ROUTING_']`**: cualquier variable futura
  `ROUTING_*` (o `VITE_*`) definida en el entorno de build quedaría expuesta
  en el bundle del cliente. No debe usarse ese prefijo para secretos; hoy solo
  existe `ROUTING_PROVIDER` (verificado en repo y `.env`).

## 3. Validación local reproducible (sin navegador)

```
node scripts/etapa4EndpointSmoke.mjs
```

Con la clave real definida SOLO en la sesión (no se guarda en disco):

```
$env:TOMTOM_API_KEY='...' ; node scripts/etapa4EndpointSmoke.mjs   # PowerShell
TOMTOM_API_KEY='...' node scripts/etapa4EndpointSmoke.mjs          # bash
```

Cubre: forma del export según la lógica de Vercel; reproducción de la
invocación clásica (defecto); handler real vía adaptador web local (réplica de
`createWebHandler`): 405/400/500 sin fugas; transmisión de `departAt`; y
despacho real del cliente con fallback real a OSRM y timeout de 15 s.
Con clave, además: solicitud REAL a TomTom y URL upstream con clave enmascarada.

## 4. Checklist manual en navegador (preview)

Prerrequisitos: fix de la firma autorizado y desplegado, `TOMTOM_API_KEY` y
`ROUTING_PROVIDER=tomtom` en Preview, redeploy hecho.

1. Abrir la preview → `Ofrecer viaje`: seleccionar origen y pulsar «Recalcular
   ruta» (o el cálculo inicial). **Red**: POST `/api/route` → 200 con
   `duration > 0`; si el flag no está activo, no debe haber llamada a
   `/api/route` (solo `router.project-osrm.org`).
2. Establecer fecha y hora válidas y recalcular → en Red, el cuerpo de
   `/api/route` debe incluir `departAt` con offset (ej. `…T08:00:00-06:00`).
3. Cambiar la **fecha** tras calcular → «Publicar Viaje» debe quedar
   deshabilitado y el submit debe rechazarse (resultado anterior obsoleto).
4. Repetir cambiando la **hora** → mismo resultado.
5. Pulsar «Recalcular ruta» → resultado nuevo; «Publicar Viaje» habilitado.
6. Repetir 1–5 con paradas intermedias (waypoints): la geometría del mapa debe
   pasar por ellas; distancia/duración coherentes.
7. Fallback a OSRM: temporalmente cambiar en Preview `TOMTOM_API_KEY` a un
   valor inválido → al recalcular debe llegar la ruta igual (OSRM) con
   `console.warn` «TomTom no devolvió una ruta utilizable…» y Red: POST
   `/api/route` → 502. Restaurar la clave después y redeployar.
8. Sin ruta o ruta obsoleta: no debe poder publicarse (botón deshabilitado).

Registrar capturas de Red/consola **sin** la cabecera/URL con `key=`.

## 5. Riesgos de seguridad del endpoint público (solo informe)

- `/api/route` es anónimo: cualquier tercero puede consumir la cuota de TomTom
  (cada 200 consume cuota del proveedor). Recomendado para etapa posterior:
  Vercel Firewall/WAF o rate limiting por IP (p. ej. `@upstash/ratelimit`),
  validación de origen (CORS estricto) y alertas de consumo en el panel de
  TomTom. **No implementado** (requiere autorización expresa).
- La clave no sale del servidor: solo viaja en la URL upstream interna (nunca
  se loguea) y los errores son genéricos (verificado por el smoke).
- `maxDuration` no requiere cambios: el default con fluid compute (300 s)
  supera con holgura el timeout interno de 10 s (`UPSTREAM_TIMEOUT_MS`).

## 6. Comandos de regresión

```
node --test test/departAt.test.ts test/offerTripPageWiring.test.ts test/routingService.test.ts test/tomTomAdapter.test.ts test/tomTomRouteHandler.test.ts test/tomTomRouteProxyRequest.test.ts
npx tsc -b --force
npx eslint
npx vite build
```
