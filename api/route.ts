/**
 * Endpoint de Vercel (serverless) que actúa de proxy SEGURO hacia la Routing
 * API de TomTom. Etapa 2: SOLO este endpoint. Todavía NO se integra en las
 * páginas ni sustituye a OSRM.
 *
 * Responsabilidad de seguridad:
 * - La clave de TomTom se lee EXCLUSIVAMENTE de `process.env.TOMTOM_API_KEY`
 *   (variable de entorno del servidor, SIN prefijo VITE_). Nunca llega al
 *   navegador ni se escribe en el repositorio.
 * - NO se acepta ninguna clave enviada por el cliente.
 * - NO es un proxy HTTP genérico: la URL de destino se construye en el servidor
 *   a partir de una lista fija de parámetros; el cliente no puede indicar una
 *   URL arbitraria.
 * - Los errores devueltos son genéricos: nunca incluyen la clave ni detalles
 *   internos de TomTom.
 *
 * Usa la Web API estándar (Request/Response) que soporta el runtime de Vercel,
 * por lo que NO requiere la dependencia @vercel/node.
 *
 * Forma del export: `handler` se exporta con nombre y además como
 * `{ fetch: handler }` por defecto. Vercel (@vercel/node, runtime Node.js)
 * trata como *web handler* (Request → Response) únicamente a las
 * exportaciones con `.fetch` o con métodos HTTP con nombre; un default
 * export plano de función se invocaría con la firma clásica (req, res) y el
 * Response devuelto se ignoraría (la petición colgaría). Verificado con
 * scripts/etapa4EndpointSmoke.mjs (Etapa 4).
 */

import { parseRouteProxyRequest, buildTomTomRouteUrl } from '../src/services/tomTomRouteProxyRequest.ts';
import { tomTomRouteToRouteResult } from '../src/services/tomTomAdapter.ts';
import type { RouteResult } from '../src/services/routingService.ts';

/** Tiempo máximo de espera a TomTom (ms). Evita peticiones colgadas. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/** Respuesta JSON con cabeceras comunes. */
const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/**
 * Handler del endpoint. Solo acepta POST.
 *
 * Cuerpo esperado (JSON):
 *   {
 *     origin: { lat, lng },
 *     destination: { lat, lng },
 *     waypoints?: [{ lat, lng }, ...],
 *     departAt: '2026-10-14T08:00:00-06:00'
 *   }
 *
 * Respuesta de éxito (200): el `RouteResult` que ya usa la app
 *   { distance (m), duration (s), geometry: LineString [lng, lat] }
 */
export const handler = async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    // 405 sin filtrar detalles. No se acepta GET ni otros métodos.
    return jsonResponse(405, { error: 'Método no permitido. Usa POST.' });
  }

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    // Fallo de configuración del servidor: no se filtra el nombre interno.
    console.error('[route] TOMTOM_API_KEY no está configurada en el servidor.');
    return jsonResponse(500, { error: 'El servicio de rutas no está disponible.' });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse(400, { error: 'El cuerpo de la petición no es JSON válido.' });
  }

  const parsed = parseRouteProxyRequest(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }

  const upstreamUrl = buildTomTomRouteUrl(parsed.value, apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Error de red o timeout. No se incluye la URL (contiene la clave).
    console.error('[route] Fallo de red o timeout al contactar a TomTom.');
    return jsonResponse(502, { error: 'No se pudo contactar al proveedor de rutas.' });
  }

  if (!upstream.ok) {
    // TomTom respondió con error HTTP. Se registra solo el código, nunca la URL.
    console.error(`[route] TomTom respondió con estado ${upstream.status}.`);
    return jsonResponse(502, { error: 'El proveedor de rutas rechazó la solicitud.' });
  }

  let tomTomData: unknown;
  try {
    tomTomData = await upstream.json();
  } catch {
    return jsonResponse(502, { error: 'El proveedor de rutas devolvió una respuesta ilegible.' });
  }

  // El adaptador devuelve null si falta la duración histórica o la geometría.
  // En ese caso NO se inventa la duración: se informa con un error genérico.
  const routeResult: RouteResult | null = tomTomRouteToRouteResult(
    tomTomData as Parameters<typeof tomTomRouteToRouteResult>[0]
  );

  if (!routeResult) {
    return jsonResponse(502, {
      error: 'El proveedor no devolvió datos suficientes para estimar la ruta.',
    });
  }

  return jsonResponse(200, routeResult);
};

// Forma exigida por el runtime de Vercel para funciones Node.js: el default
// export debe exponer `.fetch` para recibir un web Request y devolver un
// Response (changelog de Vercel, ago-2025). Sin esto, la función se invocaría
// con la firma clásica (req, res) y nunca se respondería (ver cabecera).
export default { fetch: handler };
