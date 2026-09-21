// Script temporal de verificación (se elimina al terminar).
// Comprueba contra la BD real:
//  1) que la vista trips_with_driver exponga las columnas nuevas
//  2) que el viaje b339586c tenga route_geometry y coordenadas
//  3) que la lógica distancePointToRouteKm clasificaría el viaje como 'routeNearby'
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://ymlpqjpoksiqgjniwaig.supabase.co',
  'sb_publishable_EQ0gWa1CU4PVbjadFzOrTw_7VRF3Ae7'
);

const TRIP_ID = 'b339586c-9590-415c-9f23-508261cf822b';
const SEARCH_RADIUS_KM = 5;

// ===== Réplica EXACTA de la lógica de src/services/tripService.ts =====
const toRad = (deg) => (deg * Math.PI) / 180;
function haversineDistanceKm(a, b) {
  const EARTH_RADIUS_KM = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}
function pointToSegmentDistanceKm(p, a, b) {
  if (a.lat === b.lat && a.lng === b.lng) return haversineDistanceKm(p, a);
  const d_ab = haversineDistanceKm(a, b);
  const d_ap = haversineDistanceKm(p, a);
  const d_bp = haversineDistanceKm(p, b);
  if (d_ab === 0) return d_ap;
  const t = Math.max(0, Math.min(1, (d_ap * d_ap + d_ab * d_ab - d_bp * d_bp) / (2 * d_ap * d_ab)));
  const proj = { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) };
  return haversineDistanceKm(p, proj);
}
function distancePointToRouteKm(point, geometry) {
  if (!geometry || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  let minDistance = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = { lat: coords[i][1], lng: coords[i][0] };
    const b = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const d = pointToSegmentDistanceKm(point, a, b);
    if (d < minDistance) minDistance = d;
  }
  return minDistance === Infinity ? null : minDistance;
}

async function main() {
  // 1. PROBE: ¿la vista expone las columnas nuevas?
  const probe = await sb
    .from('trips_with_driver')
    .select('id, origin, origin_lat, origin_lng, route_distance_km, route_duration_minutes, route_geometry, driver_name')
    .limit(3);

  if (probe.error) {
    console.log('PROBE_ERROR [' + probe.error.code + ']: ' + probe.error.message);
    console.log('=> La vista NO expone las columnas nuevas: la migración 006 está PENDIENTE de aplicar.');
    return;
  }

  console.log('PROBE_OK: la vista expone origin_lat/origin_lng/route_geometry.');
  for (const r of probe.data) {
    console.log(
      '  - ' + r.origin +
      ' | lat=' + r.origin_lat + ' lng=' + r.origin_lng +
      ' | geom=' + (r.route_geometry ? 'LineString(' + r.route_geometry.coordinates.length + ' pts)' : 'NULL')
    );
  }

  // 2. Viaje real de prueba
  const { data: trip, error: tripErr } = await sb
    .from('trips_with_driver')
    .select('*')
    .eq('id', TRIP_ID)
    .maybeSingle();

  if (tripErr || !trip) {
    console.log('TRIP_ERROR: ' + (tripErr ? tripErr.message : 'viaje no encontrado'));
    return;
  }

  const geom = trip.route_geometry;
  const hasOriginCoords = trip.origin_lat != null && trip.origin_lng != null;
  console.log('');
  console.log('VIAJE: ' + trip.origin + ' -> ' + trip.destination);
  console.log('  origin_lat/lng: ' + (hasOriginCoords ? trip.origin_lat + ', ' + trip.origin_lng : 'NULL'));
  console.log('  route_geometry: ' + (geom ? 'LineString ' + geom.type + ' con ' + geom.coordinates.length + ' puntos' : 'NULL'));

  if (!geom || !hasOriginCoords) return;

  const origin = { lat: trip.origin_lat, lng: trip.origin_lng };

  // 3. Simulación de la lógica de searchTripsByLocation para dos puntos:
  //    (a) fin de la ruta (≈CUCEI): cerca de la ruta, lejos del origen
  //    (b) punto medio de la ruta
  const testPoints = [
    { name: 'fin de ruta (destino)', coords: geom.coordinates[geom.coordinates.length - 1] },
    { name: 'punto medio de ruta', coords: geom.coordinates[Math.floor(geom.coordinates.length / 2)] },
  ];

  for (const tp of testPoints) {
    const p = { lat: tp.coords[1], lng: tp.coords[0] };
    const dOrigin = haversineDistanceKm(p, origin);
    const dRoute = distancePointToRouteKm(p, geom);

    let matchType = null;
    if (dOrigin !== null && dOrigin <= SEARCH_RADIUS_KM) matchType = 'origin';
    else if (dRoute !== null && dRoute <= SEARCH_RADIUS_KM) matchType = 'routeNearby';

    console.log('');
    console.log('PUNTO DE PRUEBA (' + tp.name + '): lat=' + p.lat.toFixed(6) + ' lng=' + p.lng.toFixed(6));
    console.log('  distanceToOriginKm = ' + dOrigin.toFixed(2) + ' km  -> dentro del radio: ' + (dOrigin <= SEARCH_RADIUS_KM));
    console.log('  distanceToRouteKm  = ' + (dRoute === null ? 'null' : dRoute.toFixed(4) + ' km') + '  -> dentro del radio: ' + (dRoute !== null && dRoute <= SEARCH_RADIUS_KM));
    console.log('  matchType resultante: ' + (matchType ?? 'null (DESCARTADO)'));
  }
}

main().catch((e) => console.log('FATAL: ' + e.message));