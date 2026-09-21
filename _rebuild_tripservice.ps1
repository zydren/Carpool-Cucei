 $lines = [IO.File]::ReadAllLines("src\\services\\tripService.ts", [Text.Encoding]::UTF8); 
 $startLines = $lines[0..76] -join "`r`n"; 
 $endLines = $lines[78..($lines.Length-1)] -join "`r`n"; 
 $newFunctions = "/**
 * Distancia minima (km) desde un punto geografico hasta una linea
 * representada como un GeoJSON LineString.
 *
 * Se calcula sobre cada segmento consecutivo del trayecto (par de
 * coordenadas [lng,lat]) y se toma el minimo. No se hace ninguna
 * peticion a OSRM: la ruta ya esta guardada en route_geometry y la
 * distancia se computa puramente en local."
export const distancePointToRouteKm = (
  point: { lat: number; lng: number },
  geometry: LineStringGeometry | null
): number | null => {
  if (!geometry || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return null;
  }

  const coords = geometry.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) {
    return null;
  }

  const p: LatLng = { lat: point.lat, lng: point.lng };
  let minDistance = Infinity;

  for (let i = 0; i < coords.length - 1; i += 1) {
    const a: LatLng = { lat: coords[i][1], lng: coords[i][0] };
    const b: LatLng = { lat: coords[i + 1][1], lng: coords[i + 1][0] };
    const d = pointToSegmentDistanceKm(p, a, b);
    if (d < minDistance) {
      minDistance = d;
    }
  }

  return minDistance === Infinity ? null : minDistance;
};

/**
 * Distancia (km) minima desde un punto p hasta el segmento rectilineo
 * terrestre entre a y b.
 *
 * Se proyecta el punto sobre la geodesica del segmento. Si la proyeccion
 * cae fuera del segmento, se usa la distancia a los extremos.
 */
const pointToSegmentDistanceKm = (
  p: LatLng,
  a: LatLng,
  b: LatLng
): number => {
  if (a.lat === b.lat && a.lng === b.lng) {
    return haversineDistanceKm(p, a);
  }

  const d_ab = haversineDistanceKm(a, b);
  const d_ap = haversineDistanceKm(p, a);
  const d_bp = haversineDistanceKm(p, b);

  if (d_ab === 0) {
    return d_ap;
  }

  const t = Math.max(0, Math.min(1, (d_ap * d_ap + d_ab * d_ab - d_bp * d_bp) / (2 * d_ap * d_ab)));

  const proj: LatLng = {
    lat: a.lat + t * (b.lat - a.lat),
    lng: a.lng + t * (b.lng - a.lng),
  };

  return haversineDistanceKm(p, proj);
};

interface LatLng {
  lat: number;
  lng: number;
}

const haversineDistanceKm = (a: LatLng, b: LatLng): number => {
  const EARTH_RADIUS_KM = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.pow(Math.sin(dLat/2), 2) + Math.cos(a.lat * Math.PI/180) * Math.cos(b.lat * Math.PI/180) * Math.pow(Math.sin(dLng/2), 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};
"; 
$newFunctions = $newFunctions + "`r`n"
$fullContent = $startLines + "`r`n" + $newFunctions + "`r`n" + $endLines
[IO.File]::WriteAllText("src\\services\\tripService.ts", $fullContent, [Text.Encoding]::UTF8)
Write-Output "REBUILT"
exit