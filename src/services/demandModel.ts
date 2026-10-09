/**
 * ============================================================
 * ETAPA 2 - ARBOL DE DECISION PARA PREDICCION DE DEMANDA
 * ============================================================
 * Clasificador (ID3 simplificado) que estima la categoria de demanda
 * de un viaje: 'low' (Baja) | 'medium' (Media) | 'high' (Alta).
 *
 * Implementacion PROPIA en TypeScript: el proyecto no incluye ninguna
 * libreria de Machine Learning y no se instalan dependencias nuevas.
 *
 * Reutiliza el dataset de la ETAPA 1 (`MobilityRecord` de analyticsService).
 * Solo se leen variables anonimas: nunca nombres, correos, telefonos ni ids.
 *
 * ------------------------------------------------------------------
 * 1. DEFINICION DEL PROBLEMA
 * ------------------------------------------------------------------
 * Pregunta: que nivel de demanda tendra un viaje. El objetivo (target) es
 * la CATEGORIA DE DEMANDA, derivada del INDICE DE OCUPACION: cuantas
 * solicitudes de asiento se recibieron respecto a los asientos ofrecidos.
 *
 * `requestedSeats` es la variable que realmente expresa "cuanta demanda
 * hubo" y se conoce cuando el viaje ya se publico.
 *
 * ------------------------------------------------------------------
 * 2. VARIABLES DE ENTRADA (features)
 * ------------------------------------------------------------------
 * Solo variables disponibles al PUBLICAR el viaje:
 *   hour, dayOfWeek, distanceKm, availableSeats
 *
 * IMPORTANTE (deliberado): `requestedSeats` NO es una variable de entrada.
 * Como define la etiqueta, usarlo como feature provocaria fuga de
 * informacion (data leakage): el modelo veria la respuesta y daria 100 %
 * de acierto sin aprender nada. Por eso el campo "solicitudes" del
 * formulario aparece deshabilitado y explicado.
 *
 * `originZone` y `completed/cancelled` tampoco se usan: alta cardinalidad
 * (sobreajuste) e informacion posterior al viaje.
 *
 * ------------------------------------------------------------------
 * 3. CLASES Y UMBRALES (centralizados, no arbitrarios)
 * ------------------------------------------------------------------
 * Con r = solicitudes / asientos_ofrecidos:
 *   r < 1/3        -> 'low'    (Baja)
 *   1/3 <= r < 2/3 -> 'medium' (Media)
 *   r >= 2/3       -> 'high'   (Alta)
 *
 * Los cortes 1/3 y 2/3 dividen el rango en tercios iguales: decision
 * simetrica y facil de defender ("un tercio de los asientos cubre la
 * demanda"). Ademas se exige un minimo absoluto de solicitudes para
 * 'high', para que un viaje de un solo asiento no quede como "alta".
 *
 * ------------------------------------------------------------------
 * 4. MODELO MATEMATICO
 * ------------------------------------------------------------------
 * ENTROPIA (incertidumbre de un conjunto de ejemplos S con clases C):
 *
 *              H(S) = - SUMA  p_i * log2(p_i)      p_i = |S_i| / |S|
 *
 *   H = 0  -> todas las clases iguales (nodo puro, no hay ganancia).
 *   H = 1  -> maximo desorden (dos clases 50/50, log2(2) = 1).
 *
 * GANANCIA DE INFORMACION de un atributo A sobre S:
 *
 *        IG(S, A) = H(S) - SUMA_v (|S_v| / |S|) * H(S_v)
 *
 * Se elige el atributo con MAYOR IG y, para atributos numericos, el mejor
 * punto de corte t que separa S en S_v(<= t) y S_v(> t). El arbol crece de
 * forma recursiva (ID3) con profundidad maxima, tamano minimo de hoja y
 * parada ante nodos puros: esas restricciones son el mecanismo
 * anti-sobreajuste.
 *
 * PREDICCION: se recorre el arbol comparando cada feature con su umbral
 * hasta alcanzar una hoja, cuya clase mayoritaria es la estimacion.
 *
 * ------------------------------------------------------------------
 * 5. VALIDACION
 * ------------------------------------------------------------------
 * Validacion cruzada estratificada k-fold: se reparten los ejemplos en k
 * pliegues, se entrena k veces y se predice el pliegue reservado. La
 * precision se informa SOLO si la muestra es suficiente; si no, se
 * devuelve `null` y la interfaz lo explica, para no mostrar una precision
 * enganosa.
 */

import type { MobilityDataset, MobilityRecord } from './analyticsService';

/* ================================================================== */
/* 1. TIPOS Y CONSTANTES                                               */
/* ================================================================== */

/** Categorias de demanda que el modelo aprende a distinguir. */
export type DemandClass = 'low' | 'medium' | 'high';

/** Etiquetas legibles para la interfaz. */
export const DEMAND_CLASS_LABELS: Record<DemandClass, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

/** Orden estable para tablas y ejes de la matriz de confusion. */
export const DEMAND_CLASS_ORDER: DemandClass[] = ['low', 'medium', 'high'];

/** Variantes de estilo (Tailwind) para las insignias de categoria. */
export const DEMAND_CLASS_BADGE: Record<DemandClass, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
};

/**
 * UMBRALES DE LA ETIQUETA (indice de ocupacion = solicitudes / asientos).
 * Cortes en tercios: 1/3 y 2/3. Centralizados aqui a proposito, para poder
 * explicarlos y ajustarlos sin tocar la logica del modelo.
 */
export const DEMAND_THRESHOLDS = {
  /** r >= 1/3 -> 'medium' */
  medium: 1 / 3,
  /** r >= 2/3 -> 'high' */
  high: 2 / 3,
} as const;

/** Solicitudes minimas para poder marcar 'high' (evita el caso 1/1). */
export const DEMAND_MIN_REQUESTS_HIGH = 2;

/**
 * Numero minimo de registros para ENTRENAR el modelo. Coincide con el minimo
 * de analisis de la ETAPA 1: por debajo de este tamano el modelo no
 * generaliza y cualquier precision seria enganosa.
 */
export const MIN_TRAINING_RECORDS = 35;

/** Ejemplos minimos por clase para que la clase sea aprendible. */
export const MIN_SAMPLES_PER_CLASS = 5;

/** Numero maximo de pliegues de la validacion cruzada. */
export const CROSS_VALIDATION_FOLDS = 5;

/** Variables de entrada del modelo, en orden de evaluacion. */
export type DemandFeatureKey = 'hour' | 'dayOfWeek' | 'distanceKm' | 'availableSeats';

/** Vector de features de un ejemplo. */
export type DemandFeatures = Record<DemandFeatureKey, number>;

/** Nombres legibles de las features (reglas del arbol y tooltips). */
export const FEATURE_LABELS: Record<DemandFeatureKey, string> = {
  hour: 'Hora de salida',
  dayOfWeek: 'Dia de la semana',
  distanceKm: 'Distancia (km)',
  availableSeats: 'Asientos disponibles',
};

/** Lista de features candidatas, en el orden en que se evalúan. */
const FEATURE_KEYS: DemandFeatureKey[] = [
  'hour',
  'dayOfWeek',
  'distanceKm',
  'availableSeats',
];

/** Formatea un valor de feature de forma legible. */
export const formatFeatureValue = (key: DemandFeatureKey, value: number): string => {
  if (key === 'hour') {
    return `${String(Math.round(value)).padStart(2, '0')}:00`;
  }
  if (key === 'dayOfWeek') {
    const names: Record<number, string> = {
      1: 'domingo',
      2: 'lunes',
      3: 'martes',
      4: 'miercoles',
      5: 'jueves',
      6: 'viernes',
      7: 'sabado',
    };
    return names[Math.round(value)] ?? String(value);
  }
  if (key === 'distanceKm') {
    return `${value.toFixed(1)} km`;
  }
  return `${value} asiento${value === 1 ? '' : 's'}`;
};

/* ================================================================== */
/* 2. ETIQUETADO (target)                                              */
/* ================================================================== */

/**
 * Determina la categoria de demanda de un viaje a partir de las solicitudes
 * recibidas y los asientos ofrecidos (indice de ocupacion con cortes en
 * tercios). Devuelve `null` si los datos no son utilizables.
 */
export const classifyDemand = (
  requestedSeats: number,
  availableSeats: number
): DemandClass | null => {
  if (!Number.isFinite(requestedSeats) || !Number.isFinite(availableSeats)) {
    return null;
  }
  if (requestedSeats < 0 || availableSeats < 0) {
    return null;
  }

  // Sin solicitudes no hay demanda: siempre 'low'.
  if (requestedSeats === 0) {
    return 'low';
  }

  // Si el viaje no ofrece asientos se usa la propia demanda como capacidad,
  // para no dividir entre cero (evita NaN y mantiene el dato real).
  const capacity = availableSeats > 0 ? availableSeats : requestedSeats;
  const ratio = requestedSeats / capacity;

  if (requestedSeats >= DEMAND_MIN_REQUESTS_HIGH && ratio >= DEMAND_THRESHOLDS.high) {
    return 'high';
  }
  if (ratio >= DEMAND_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'low';
};

/* ================================================================== */
/* 3. ENTROPIA                                                         */
/* ================================================================== */

/** Devuelve la moda de las etiquetas (clase mayoritaria de un conjunto). */
const majorityClass = (labels: DemandClass[]): DemandClass => {
  const counts = new Map<DemandClass, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best: DemandClass = 'low';
  let bestCount = -1;
  for (const cls of DEMAND_CLASS_ORDER) {
    const count = counts.get(cls) ?? 0;
    if (count > bestCount) {
      best = cls;
      bestCount = count;
    }
  }
  return best;
};

/**
 * ENTROPIA DE SHANNON
 *
 *        H(S) = - SUMA_i  p_i * log2(p_i)        p_i = |S_i| / |S|
 *
 * Mide el desorden de las clases presentes en S.
 *   - Si |S| = 0 devuelve 0 (evita NaN).
 *   - Si todas las clases son iguales devuelve 0 (nodo puro).
 *   - El maximo se alcanza con la distribucion mas uniforme posible.
 */
export const entropy = (labels: DemandClass[]): number => {
  const total = labels.length;
  if (total === 0) {
    return 0;
  }

  const counts = new Map<DemandClass, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  let h = 0;
  for (const count of counts.values()) {
    if (count <= 0) {
      continue;
    }
    const p = count / total;
    h -= p * Math.log2(p);
  }

  // Evita restos negativos por precision de coma flotante (p.ej. 1e-16).
  return h > 0 ? h : 0;
};

/** Entropia a partir de conteos por clase (usada en el barrido de IG). */
const entropyFromCounts = (counts: Map<DemandClass, number>, size: number): number => {
  if (size <= 0) {
    return 0;
  }
  let h = 0;
  for (const count of counts.values()) {
    if (count <= 0) {
      continue;
    }
    const p = count / size;
    h -= p * Math.log2(p);
  }
  return h > 0 ? h : 0;
};

/* ================================================================== */
/* 4. GANANCIA DE INFORMACION                                          */
/* ================================================================== */

/**
 * GANANCIA DE INFORMACION de un atributo numerico A sobre el conjunto S:
 *
 *        IG(S, A) = H(S) - SUMA_v (|S_v| / |S|) * H(S_v)
 *
 * Busca el mejor punto de corte t entre los valores observados (el punto
 * medio entre valores consecutivos distintos, convencion de ID3) y devuelve
 * la mayor ganancia posible. IG = 0 significa que el atributo no separa las
 * clases, por lo que el llamador lo descarta.
 *
 * Complejidad: O(n log n) por atributo, porque cada entropia parcial se
 * actualiza en O(1) al mover un ejemplo del lado derecho al izquierdo.
 */
export const informationGain = (
  examples: DemandExample[],
  feature: DemandFeatureKey
): { threshold: number; gain: number } => {
  const total = examples.length;
  if (total === 0) {
    return { threshold: 0, gain: 0 };
  }

  const parentEntropy = entropy(examples.map((example) => example.label));
  if (parentEntropy === 0) {
    return { threshold: 0, gain: 0 };
  }

  const sorted = [...examples].sort(
    (a, b) => a.features[feature] - b.features[feature]
  );

  let bestThreshold = sorted[0]!.features[feature];
  let bestGain = 0;

  const leftCounts = new Map<DemandClass, number>();
  const rightCounts = new Map<DemandClass, number>();
  for (const example of sorted) {
    rightCounts.set(example.label, (rightCounts.get(example.label) ?? 0) + 1);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;

    // Movemos el ejemplo actual de la derecha a la izquierda.
    leftCounts.set(current.label, (leftCounts.get(current.label) ?? 0) + 1);
    rightCounts.set(current.label, (rightCounts.get(current.label) ?? 0) - 1);

    const leftSize = i + 1;
    const rightSize = total - leftSize;
    if (leftSize === 0 || rightSize === 0) {
      continue;
    }

    // Solo hay separacion real entre valores distintos.
    if (current.features[feature] === next.features[feature]) {
      continue;
    }

    const threshold = (current.features[feature] + next.features[feature]) / 2;

    const weighted =
      (leftSize / total) * entropyFromCounts(leftCounts, leftSize) +
      (rightSize / total) * entropyFromCounts(rightCounts, rightSize);

    const gain = parentEntropy - weighted;
    if (gain > bestGain) {
      bestGain = gain;
      bestThreshold = threshold;
    }
  }

  return { threshold: bestThreshold, gain: bestGain };
};

/* ================================================================== */
/* 5. ESTRUCTURA DEL ARBOL                                             */
/* ================================================================== */

/** Ejemplo de entrenamiento: vector de features + etiqueta (target). */
export interface DemandExample {
  features: DemandFeatures;
  label: DemandClass;
}

/**
 * Nodo del arbol. Si `feature` es `null` el nodo es una hoja y `prediction`
 * es la categoria estimada para todo ejemplo que llegue a el.
 */
export interface DecisionNode {
  /** Feature evaluada en el nodo; `null` si es una hoja. */
  feature: DemandFeatureKey | null;
  /** Umbral: rama izquierda si value <= threshold, derecha si value > threshold. */
  threshold: number | null;
  /** IG(S, A) que justifico elegir este nodo (0 en nodos puros y hojas). */
  infoGain: number;
  /** H(S) del conjunto de ejemplos que llegan al nodo. */
  entropy: number;
  /** Numero de ejemplos que llegan al nodo. */
  samples: number;
  /** Clase mayoritaria del nodo (salida si el nodo es hoja). */
  prediction: DemandClass;
  left: DecisionNode | null;
  right: DecisionNode | null;
}

/** Parametros de control del crecimiento del arbol. */
export interface TreeOptions {
  /** Profundidad maxima: principal mecanismo anti-sobreajuste. */
  maxDepth: number;
  /** Numero minimo de ejemplos para seguir dividiendo. */
  minSamplesSplit: number;
  /** Numero minimo de ejemplos por hoja. */
  minSamplesLeaf: number;
}

/** Parametros por defecto. */
export const DEFAULT_TREE_OPTIONS: TreeOptions = {
  maxDepth: 3,
  minSamplesSplit: 10,
  minSamplesLeaf: 3,
};

/**
 * CONSTRUCCION RECURSIVA DEL ARBOL (ID3)
 *
 * En cada nodo se evalua TODAS las features candidatas y se elige la de mayor
 * ganancia de informacion. El nodo se convierte en hoja cuando:
 *   - el conjunto es puro (H = 0), o
 *   - no queda profundidad, o
 *   - hay pocos ejemplos para dividir, o
 *   - ninguna separacion aporta ganancia real, o
 *   - alguna rama quedaria por debajo del tamano minimo de hoja.
 * Cada una de esas paradas evita el sobreajuste.
 */
export const buildDecisionTree = (
  examples: DemandExample[],
  options: TreeOptions = DEFAULT_TREE_OPTIONS
): DecisionNode => {
  const labels = examples.map((example) => example.label);
  const nodeEntropy = entropy(labels);

  const base: DecisionNode = {
    feature: null,
    threshold: null,
    infoGain: 0,
    entropy: nodeEntropy,
    samples: examples.length,
    prediction: majorityClass(labels),
    left: null,
    right: null,
  };

  // Conjunto vacio o puro: no hay nada que aprender.
  if (examples.length === 0 || nodeEntropy === 0) {
    return base;
  }
  if (options.maxDepth <= 0) {
    return base;
  }
  if (examples.length < options.minSamplesSplit) {
    return base;
  }

  // Seleccion del atributo con mayor ganancia de informacion.
  let bestFeature: DemandFeatureKey | null = null;
  let bestThreshold = 0;
  let bestGain = 0;

  for (const feature of FEATURE_KEYS) {
    const candidate = informationGain(examples, feature);
    if (candidate.gain > bestGain) {
      bestGain = candidate.gain;
      bestFeature = feature;
      bestThreshold = candidate.threshold;
    }
  }

  // Ninguna feature separa las clases: el nodo se queda como hoja.
  if (bestFeature === null) {
    return base;
  }

  const splitFeature = bestFeature;
  const splitThreshold = bestThreshold;

  const leftExamples = examples.filter(
    (example) => example.features[splitFeature] <= splitThreshold
  );
  const rightExamples = examples.filter(
    (example) => example.features[splitFeature] > splitThreshold
  );

  // Restricciones anti-sobreajuste sobre el tamano de las hojas.
  if (
    leftExamples.length < options.minSamplesLeaf ||
    rightExamples.length < options.minSamplesLeaf
  ) {
    return base;
  }

  const nextOptions: TreeOptions = { ...options, maxDepth: options.maxDepth - 1 };

  return {
    feature: splitFeature,
    threshold: splitThreshold,
    infoGain: bestGain,
    entropy: nodeEntropy,
    samples: examples.length,
    prediction: base.prediction,
    left: buildDecisionTree(leftExamples, nextOptions),
    right: buildDecisionTree(rightExamples, nextOptions),
  };
};

/* ================================================================== */
/* 5b. PODA DEL ARBOL                                                  */
/* ================================================================== */

/**
 * PODA DEL ARBOL (post-construccion, recursiva de abajo hacia arriba).
 *
 * ID3 puede dejar divisiones redundantes: nodos cuyas DOS ramas terminan
 * prediciendo la MISMA clase. Esa division no separa nada, solo encubre el
 * arbol (mas nodos, mas profundidad y la misma prediccion).
 *
 * Regla de poda:
 *   - Se podan PRIMERO los hijos (recursion post-orden).
 *   - Si tras podar ambos hijos son hojas con la MISMA prediccion, el nodo
 *     se convierte en hoja de esa clase (se elimina la division).
 *   - Si ambos hijos predicen distinto, la division se MANTIENE.
 *
 * Conservadora por diseno: al colapsar solo cuando las dos ramas daban la
 * misma clase, NINGUN ejemplo cambia de prediccion, por lo que la precision
 * medida por la validacion cruzada sigue siendo valida para el arbol podado.
 *
 * Se aplica SIEMPRE despues de `buildDecisionTree` (nunca durante la
 * construccion), porque la regla necesita el subarbol completo ya formado.
 */
export const pruneDecisionTree = (node: DecisionNode): DecisionNode => {
  // Hoja: no hay nada que podar.
  if (node.feature === null || node.left === null || node.right === null) {
    return node;
  }

  // 1) Poda primero los hijos (de abajo hacia arriba).
  const left = pruneDecisionTree(node.left);
  const right = pruneDecisionTree(node.right);

  // 2) Ambas ramas terminan en hojas de la MISMA clase -> division redundante.
  const leftIsLeaf = left.feature === null && left.left === null && left.right === null;
  const rightIsLeaf = right.feature === null && right.left === null && right.right === null;
  if (leftIsLeaf && rightIsLeaf && left.prediction === right.prediction) {
    return {
      feature: null,
      threshold: null,
      infoGain: 0,
      entropy: node.entropy,
      samples: node.samples,
      prediction: left.prediction,
      left: null,
      right: null,
    };
  }

  // 3) La division aporta (o alguna rama sigue siendo interna): se conserva.
  return { ...node, left, right };
};

/* ================================================================== */
/* 6. PREDICCION                                                       */
/* ================================================================== */

/** Un paso de la ruta seguida por la prediccion (explicabilidad). */
export interface PredictionStep {
  label: string;
  value: string;
  threshold: string;
  branch: 'izquierda' | 'derecha';
}

/** Resultado de predecir la demanda de un viaje hipotetico. */
export interface DemandPrediction {
  demand: DemandClass;
  demandLabel: string;
  /** Ruta seguida por la prediccion, para explicarla al usuario. */
  path: PredictionStep[];
  /** Numero de ejemplos que sustentan la hoja alcanzada. */
  support: number;
}

/**
 * Predice la demanda recorriendo el arbol de raiz a hoja: en cada nodo se
 * compara la feature del viaje con el umbral aprendido y se toma la rama
 * correspondiente. Al llegar a una hoja, su clase es la estimacion.
 */
export const predictDemand = (
  node: DecisionNode,
  features: DemandFeatures
): DemandPrediction => {
  const path: PredictionStep[] = [];
  let current: DecisionNode = node;

  while (current.feature !== null) {
    const key = current.feature;
    const threshold = current.threshold ?? 0;
    const value = features[key];
    const goLeft = value <= threshold;

    path.push({
      label: FEATURE_LABELS[key],
      value: formatFeatureValue(key, value),
      threshold: formatFeatureValue(key, threshold),
      branch: goLeft ? 'izquierda' : 'derecha',
    });

    const next = goLeft ? current.left : current.right;
    if (next === null) {
      break;
    }
    current = next;
  }

  return {
    demand: current.prediction,
    demandLabel: DEMAND_CLASS_LABELS[current.prediction],
    path,
    support: current.samples,
  };
};

/* ================================================================== */
/* 7. REPRESENTACION DEL ARBOL                                         */
/* ================================================================== */

/** Nodo aplanado, listo para pintarse en la interfaz. */
export interface TreeNodeSummary {
  /** Regla en notacion textual, con los conectores tipo arbol de consola. */
  condition: string;
  featureLabel: string;
  predictionLabel: string;
  /** Clase del nodo, para pintar la insignia sin analizar texto. */
  predictionClass: DemandClass;
  samples: number;
  entropy: number;
  gain: number;
  isLeaf: boolean;
  /** Identificador estable para usar como key de React. */
  id: string;
}

/**
 * Aplana el arbol a una lista de nodos con notacion textual, que es lo que
 * alimenta tanto las reglas escritas como la vista visual.
 */
export const summarizeTree = (node: DecisionNode): TreeNodeSummary[] => {
  const result: TreeNodeSummary[] = [];

  const walk = (
    current: DecisionNode,
    isRoot: boolean,
    isLast: boolean,
    prefix: string,
    pathId: string
  ): void => {
    const connector = isRoot ? '' : isLast ? '└── ' : '├── ';

    if (current.feature === null) {
      result.push({
        condition: `${prefix}${connector}Hoja → ${DEMAND_CLASS_LABELS[current.prediction]}`,
        featureLabel: 'Hoja',
        predictionLabel: DEMAND_CLASS_LABELS[current.prediction],
        predictionClass: current.prediction,
        samples: current.samples,
        entropy: current.entropy,
        gain: 0,
        isLeaf: true,
        id: `${pathId}-leaf`,
      });
      return;
    }

    const label = FEATURE_LABELS[current.feature];
    const thresholdText = formatFeatureValue(current.feature, current.threshold ?? 0);

    result.push({
      condition:
        `${prefix}${connector}${label} ≤ ${thresholdText}` +
        `  →  ${DEMAND_CLASS_LABELS[current.prediction]}` +
        ` (n=${current.samples}, IG=${current.infoGain.toFixed(3)})`,
      featureLabel: label,
      predictionLabel: DEMAND_CLASS_LABELS[current.prediction],
      predictionClass: current.prediction,
      samples: current.samples,
      entropy: current.entropy,
      gain: current.infoGain,
      isLeaf: false,
      id: pathId,
    });

    const childPrefix = isRoot ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
    if (current.left !== null) {
      walk(current.left, false, false, childPrefix, `${pathId}-l`);
    }
    if (current.right !== null) {
      walk(current.right, false, true, childPrefix, `${pathId}-r`);
    }
  };

  walk(node, true, true, '', 'root');
  return result;
};

/** Numero total de nodos del arbol (mide su complejidad). */
export const countNodes = (node: DecisionNode): number => {
  let total = 1;
  if (node.left !== null) {
    total += countNodes(node.left);
  }
  if (node.right !== null) {
    total += countNodes(node.right);
  }
  return total;
};

/**
 * Profundidad real del arbol (numero de niveles de decisiones).
 * Una hoja vale 0; un nodo con hijos vale 1 + la mayor profundidad de sus hijos.
 */
export const treeDepth = (node: DecisionNode): number => {
  const hasChildren = node.left !== null || node.right !== null;
  if (!hasChildren) {
    return 0;
  }

  let deepest = 0;
  if (node.left !== null) {
    deepest = Math.max(deepest, treeDepth(node.left));
  }
  if (node.right !== null) {
    deepest = Math.max(deepest, treeDepth(node.right));
  }
  return deepest + 1;
};

/* ================================================================== */
/* 8. PREPARACION DEL DATASET                                          */
/* ================================================================== */

/** Resultado de convertir los registros en ejemplos de entrenamiento. */
export interface DatasetPreparation {
  examples: DemandExample[];
  /** Registros descartados por fecha u hora no interpretables. */
  skipped: number;
  distribution: Record<DemandClass, number>;
  /** Medianas usadas para imputar distancias nulas. */
  imputations: Partial<Record<DemandFeatureKey, number>>;
}

/** Mediana de una lista de numeros (null si esta vacia). */
const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
};

/**
 * Convierte `MobilityRecord` (ETAPA 1) en ejemplos de entrenamiento.
 *
 * - NO modifica los registros originales: crea objetos nuevos.
 * - Descarta registros con dia u hora no interpretables (dato de origen
 *   corrupto, no informacion de demanda).
 * - Imputa distancias nulas con la MEDIANA del propio dataset: es la
 *   practica estandar y no inventa datos nuevos.
 * - `requestedSeats` se usa SOLO como etiqueta, nunca como feature.
 */
export const prepareTrainingData = (records: MobilityRecord[]): DatasetPreparation => {
  const valid = records.filter(
    (record) =>
      record.dayOfWeek >= 1 && record.dayOfWeek <= 7 && record.hour >= 0 && record.hour <= 23
  );

  const distances = valid
    .map((record) => record.distanceKm)
    .filter((value): value is number => value !== null);

  const imputations: Partial<Record<DemandFeatureKey, number>> = {};
  const medianDistance = median(distances);
  if (medianDistance !== null) {
    imputations.distanceKm = medianDistance;
  }

  const distribution: Record<DemandClass, number> = { low: 0, medium: 0, high: 0 };
  const examples: DemandExample[] = [];

  for (const record of valid) {
    const label = classifyDemand(record.requestedSeats, record.availableSeats);
    if (label === null) {
      continue;
    }

    examples.push({
      features: {
        hour: record.hour,
        dayOfWeek: record.dayOfWeek,
        distanceKm: record.distanceKm ?? medianDistance ?? 0,
        availableSeats: record.availableSeats,
      },
      label,
    });
    distribution[label] += 1;
  }

  return { examples, skipped: records.length - valid.length, distribution, imputations };
};

/* ================================================================== */
/* 9. ENTRENAMIENTO Y VALIDACION                                       */
/* ================================================================== */

/** Matriz de confusion: matrix[real][predicho], con DEMAND_CLASS_ORDER. */
export interface ConfusionMatrix {
  matrix: number[][];
  correct: number;
  total: number;
}

/** Resultado del entrenamiento: el modelo mas su evaluacion. */
export interface DemandModelResult {
  /** false si no hay datos suficientes: la interfaz muestra el aviso. */
  trained: boolean;
  tree: DecisionNode | null;
  examples: DemandExample[];
  distribution: Record<DemandClass, number>;
  /** Registros aportados por el dataset de la ETAPA 1. */
  totalRecords: number;
  /** Registros efectivamente usados para entrenar. */
  usedRecords: number;
  skippedRecords: number;
  /** Accuracy 0..1, o null si la muestra no permite una evaluacion fiable. */
  accuracy: number | null;
  /** Explicacion de por que no se muestra accuracy (cuando es null). */
  accuracyNote: string | null;
  confusion: ConfusionMatrix | null;
  folds: number;
  imputations: Partial<Record<DemandFeatureKey, number>>;
  nodes: number;
  depth: number;
  /** Motivo por el que no se entreno (si `trained` es false). */
  reason: string | null;
}

/**
 * Entrena el arbol de decision y lo valida con k-fold estratificado.
 *
 * REGLA DE SEGURIDAD ESTADISTICA (para no mostrar metricas enganosas):
 *   * se requieren al menos MIN_TRAINING_RECORDS ejemplos;
 *   * cada clase presente debe tener al menos MIN_SAMPLES_PER_CLASS;
 *   * la accuracy solo se informa si se cumplieron ambos requisitos.
 * Si algo falla, `trained` es false, no hay arbol y no se muestra ninguna
 * prediccion: nunca se inventan datos ni se dan resultados sin respaldo.
 */
export const trainDemandModel = (dataset: MobilityDataset): DemandModelResult => {
  const { examples, skipped, distribution, imputations } = prepareTrainingData(
    dataset.records
  );

  const notTrained = (reason: string): DemandModelResult => ({
    trained: false,
    tree: null,
    examples,
    distribution,
    totalRecords: dataset.records.length,
    usedRecords: examples.length,
    skippedRecords: skipped,
    accuracy: null,
    accuracyNote: null,
    confusion: null,
    folds: 0,
    imputations,
    nodes: 0,
    depth: 0,
    reason,
  });

  // La via de respaldo (RLS) no conoce las solicitudes: no puede etiquetar.
  if (dataset.source === 'visible') {
    return notTrained(
      'El modo de respaldo (RLS) no incluye el conteo de solicitudes por viaje, que es la ' +
        'base de la etiqueta de demanda. Aplica la migracion de analitica y accede con una ' +
        'sesion autenticada para entrenar el modelo.'
    );
  }

  if (examples.length < MIN_TRAINING_RECORDS) {
    return notTrained(
      `Datos insuficientes para entrenar el modelo. Se requieren al menos ` +
        `${MIN_TRAINING_RECORDS} registros y hay ${examples.length}.`
    );
  }

  const presentClasses = DEMAND_CLASS_ORDER.filter((cls) => distribution[cls] > 0);

  const thinClass = presentClasses.find((cls) => distribution[cls] < MIN_SAMPLES_PER_CLASS);
  if (thinClass !== undefined) {
    return notTrained(
      `Datos insuficientes para entrenar el modelo. La categoria "${DEMAND_CLASS_LABELS[thinClass]}" ` +
        `tiene ${distribution[thinClass]} ejemplos y se requieren ${MIN_SAMPLES_PER_CLASS}.`
    );
  }

  if (presentClasses.length < 2) {
    return notTrained(
      'Datos insuficientes para entrenar el modelo: solo se detecto una categoria de demanda ' +
        'en los registros analizados.'
    );
  }

  // Numero de pliegues: nunca mas de lo que permita la clase mas pequena.
  const maxBySmallestClass = Math.min(
    ...presentClasses.map((cls) => Math.floor(distribution[cls] / MIN_SAMPLES_PER_CLASS))
  );
  const folds = Math.max(2, Math.min(CROSS_VALIDATION_FOLDS, maxBySmallestClass));

  // Reparto ESTRATIFICADO: round-robin dentro de cada clase, de modo que
  // cada pliegue conserva la proporcion de clases de la muestra.
  const buckets: DemandExample[][] = [];
  for (let i = 0; i < folds; i++) {
    buckets.push([]);
  }
  for (const cls of DEMAND_CLASS_ORDER) {
    const classExamples = examples.filter((example) => example.label === cls);
    classExamples.forEach((example, index) => {
      const bucket = buckets[index % folds]!;
      bucket.push(example);
    });
  }

  const matrix: number[][] = DEMAND_CLASS_ORDER.map(() =>
    DEMAND_CLASS_ORDER.map(() => 0)
  );
  let correct = 0;
  let evaluated = 0;

  for (let i = 0; i < folds; i++) {
    const testSet = buckets[i]!;
    const trainSet: DemandExample[] = [];
    for (let j = 0; j < folds; j++) {
      if (j === i) {
        continue;
      }
      for (const example of buckets[j]!) {
        trainSet.push(example);
      }
    }
    if (testSet.length === 0 || trainSet.length === 0) {
      continue;
    }

    const foldTree = pruneDecisionTree(buildDecisionTree(trainSet));
    for (const example of testSet) {
      const predicted = predictDemand(foldTree, example.features).demand;
      const realIndex = DEMAND_CLASS_ORDER.indexOf(example.label);
      const predIndex = DEMAND_CLASS_ORDER.indexOf(predicted);
      matrix[realIndex]![predIndex] += 1;
      if (predicted === example.label) {
        correct += 1;
      }
      evaluated += 1;
    }
  }

  // Solo se informa accuracy si la muestra evaluada es suficiente.
  const reliable = evaluated >= MIN_TRAINING_RECORDS;

  // Modelo final: se entrena con TODOS los ejemplos y se PODA (poda de
  // nodos redundantes; no altera predicciones). La validacion previa ya
  // evaluo sobre pliegues que nunca participaron en su entrenamiento.
  const tree = pruneDecisionTree(buildDecisionTree(examples));

  return {
    trained: true,
    tree,
    examples,
    distribution,
    totalRecords: dataset.records.length,
    usedRecords: examples.length,
    skippedRecords: skipped,
    accuracy: reliable && evaluated > 0 ? correct / evaluated : null,
    accuracyNote: reliable
      ? null
      : 'La muestra es demasiado pequena para una evaluacion fiable; se omite la ' +
        'precision en lugar de mostrar un valor enganoso.',
    confusion: reliable ? { matrix, correct, total: evaluated } : null,
    folds,
    imputations,
    nodes: countNodes(tree),
    depth: treeDepth(tree),
    reason: null,
  };
};