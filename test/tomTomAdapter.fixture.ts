/**
 * Fixture ESTRUCTURAL de una respuesta de TomTom Routing API `calculateRoute`
 * con `computeTravelTimeFor=all`.
 *
 * IMPORTANTE / HONESTIDAD:
 * - NO es la respuesta real capturada de tu cuenta. Los valores numéricos son
 *   de ejemplo y coherentes con la forma DOCUMENTADA de la API (campos del
 *   `summary` y `legs[0].points`). No contienen ninguna clave de API.
 * - El objetivo es verificar el ADAPTADOR (transformación de forma), no validar
 *   números de tráfico reales.
 *
 * Para usarlo como prueba de humo real, reemplaza `coords`/valores por una
 * respuesta capturada por ti (asegurándote de no incluir la `key`).
 */

/** Coordenadas de ejemplo (zona CUCEI / Guadalajara) para la geometría. */
const coords = [
  { latitude: 20.6586, longitude: -103.3254 },
  { latitude: 20.6601, longitude: -103.3298 },
  { latitude: 20.664, longitude: -103.3322 },
];

/** Respuesta completa y válida (2 legs para probar concatenación de puntos). */
export const tomTomRouteValid = {
  routes: [
    {
      summary: {
        lengthInMeters: 5230,
        travelTimeInSeconds: 900,
        trafficDelayInSeconds: 120,
        trafficLengthInMeters: 1500,
        departAt: '2026-10-14T08:00:00-06:00',
        arriveAt: '2026-10-14T08:15:00-06:00',
        noTrafficTravelTimeInSeconds: 780,
        historicTrafficTravelTimeInSeconds: 845,
        liveTrafficIncidentsTravelTimeInSeconds: 860,
      },
      legs: [
        { points: [coords[0], coords[1]] },
        { points: [coords[1], coords[2]] },
      ],
    },
  ],
};

/** Sin `historicTrafficTravelTimeInSeconds` (p. ej. computeTravelTimeFor sin 'all'). */
export const tomTomRouteMissingHistoric = {
  routes: [
    {
      summary: {
        lengthInMeters: 5230,
        travelTimeInSeconds: 900,
        noTrafficTravelTimeInSeconds: 780,
        liveTrafficIncidentsTravelTimeInSeconds: 860,
      },
      legs: [{ points: coords }],
    },
  ],
};

/** Con histórica pero geometría insuficiente (un solo punto). */
export const tomTomRouteShortGeometry = {
  routes: [
    {
      summary: {
        lengthInMeters: 10,
        travelTimeInSeconds: 30,
        historicTrafficTravelTimeInSeconds: 30,
      },
      legs: [{ points: [coords[0]] }],
    },
  ],
};

/** Puntos con coordenadas inválidas (NaN) intercalados: deben descartarse. */
export const tomTomRouteWithBadPoints = {
  routes: [
    {
      summary: {
        lengthInMeters: 100,
        travelTimeInSeconds: 40,
        historicTrafficTravelTimeInSeconds: 40,
      },
      legs: [
        {
          points: [
            coords[0],
            { latitude: NaN, longitude: -103.33 },
            coords[1],
            { latitude: 20.664, longitude: undefined as unknown as number },
            coords[2],
          ],
        },
      ],
    },
  ],
};

/** `routes` vacío. */
export const tomTomRouteEmpty = { routes: [] };

/** Respuesta nula/ indefinida (defensa del adaptador). */
export const tomTomRouteNull = null;

/**
 * Puntos con coordenadas FUERA de rango geográfico (lat > 90, lng > 180, y
 * negativas fuera de rango). Deben descartarse como inválidos.
 */
export const tomTomRouteOutOfRange = {
  routes: [
    {
      summary: {
        lengthInMeters: 100,
        travelTimeInSeconds: 40,
        historicTrafficTravelTimeInSeconds: 40,
      },
      legs: [
        {
          points: [
            coords[0],
            { latitude: 91, longitude: -103.33 }, // lat > 90
            { latitude: 20.664, longitude: 181 }, // lng > 180
            { latitude: -91, longitude: -103.33 }, // lat < -90
            { latitude: 20.664, longitude: -181 }, // lng < -180
            coords[1],
            coords[2],
          ],
        },
      ],
    },
  ],
};

/**
 * Puntos CONSECUTIVOS duplicados dentro del mismo leg (p. ej. el punto de unión
 * repetido). No deben generar segmentos de longitud cero.
 */
export const tomTomRouteDuplicatedConsecutive = {
  routes: [
    {
      summary: {
        lengthInMeters: 100,
        travelTimeInSeconds: 40,
        historicTrafficTravelTimeInSeconds: 40,
      },
      legs: [
        {
          points: [coords[0], coords[0], coords[1], coords[1], coords[2]],
        },
      ],
    },
  ],
};

/** `lengthInMeters` negativo: ruta inválida. */
export const tomTomRouteNegativeDistance = {
  routes: [
    {
      summary: {
        lengthInMeters: -5230,
        travelTimeInSeconds: 900,
        historicTrafficTravelTimeInSeconds: 845,
      },
      legs: [{ points: coords }],
    },
  ],
};

/** `historicTrafficTravelTimeInSeconds` negativo: ruta inválida. */
export const tomTomRouteNegativeDuration = {
  routes: [
    {
      summary: {
        lengthInMeters: 5230,
        travelTimeInSeconds: 900,
        historicTrafficTravelTimeInSeconds: -845,
      },
      legs: [{ points: coords }],
    },
  ],
};
