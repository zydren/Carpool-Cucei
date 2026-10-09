/**
 * Representación del árbol de decisión para "Predicción inteligente de demanda".
 * No usa librería de diagramas (el proyecto no incluye ninguna y no se instalan
 * dependencias nuevas): son nodos HTML/CSS con la paleta actual (slate + teal).
 */

import { CornerDownRight, GitBranch, Leaf } from 'lucide-react';

import {
  DEMAND_CLASS_BADGE,
  DEMAND_CLASS_LABELS,
  DEMAND_CLASS_ORDER,
  countNodes,
  summarizeTree,
  treeDepth,
} from '../../services/demandModel';
import type { DecisionNode, TreeNodeSummary } from '../../services/demandModel';

interface DecisionTreeViewProps {
  tree: DecisionNode;
  /** Muestra las métricas IG / H por nodo (documentación del modelo). */
  showMetrics?: boolean;
}

/** Barra de entropía: representa visualmente H(S) del nodo (0…1). */
function EntropyBar({ entropy }: { entropy: number }) {
  const pct = Math.max(0, Math.min(1, entropy)) * 100;
  return (
    <div className="flex items-center gap-1.5" title={`Entropía H(S) = ${entropy.toFixed(3)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-semibold text-slate-500 tabular-nums">
        H={entropy.toFixed(2)}
      </span>
    </div>
  );
}

/** Reglas del modelo en notación textual (estilo árbol de consola). */
function RuleList({ nodes }: { nodes: TreeNodeSummary[] }) {
  return (
    <ul className="space-y-1.5">
      {nodes.map((node) => (
        <li
          key={node.id}
          className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
        >
          <code className="whitespace-pre font-mono text-xs text-slate-700">{node.condition}</code>
        </li>
      ))}
    </ul>
  );
}
// __APPEND__


/**
 * Diagrama jerárquico del árbol. Se aplana a nodos indentados: conveys la
 * misma información que el diagrama clásico, pero es responsivo y no requiere
 * librería de grafos.
 */
function TreeDiagram({ tree, showMetrics }: { tree: DecisionNode; showMetrics: boolean }) {
  const nodes = summarizeTree(tree);

  return (
    <ul className="space-y-2">
      {nodes.map((node) => {
        const { isLeaf, predictionClass } = node;
        return (
          <li
            key={node.id}
            className={`rounded-xl border p-3 ${
              isLeaf ? 'border-slate-200 bg-white' : 'border-slate-300 bg-slate-50'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  isLeaf ? 'bg-slate-100 text-slate-600' : 'bg-slate-900 text-white'
                }`}
              >
                {isLeaf ? (
                  <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </span>

              <span className="text-sm font-semibold text-slate-900">
                {isLeaf ? 'Hoja de decisión' : node.featureLabel}
              </span>

              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${DEMAND_CLASS_BADGE[predictionClass]}`}
              >
                {isLeaf ? node.predictionLabel : `Si no, ${node.predictionLabel}`}
              </span>

              <span className="text-xs text-slate-400 tabular-nums">n={node.samples}</span>
            </div>

            {showMetrics && (
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <EntropyBar entropy={node.entropy} />
                {!isLeaf && (
                  <span
                    className="text-[10px] font-semibold text-slate-500 tabular-nums"
                    title="Ganancia de información IG(S, A) que justificó elegir este atributo"
                  >
                    IG={node.gain.toFixed(3)}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Panel principal con el árbol entrenado: diagrama + reglas + resumen. */
export default function DecisionTreeView({ tree, showMetrics = true }: DecisionTreeViewProps) {
  const nodes = summarizeTree(tree);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          Nodos: <strong className="text-slate-700">{countNodes(tree)}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <CornerDownRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          Profundidad: <strong className="text-slate-700">{treeDepth(tree)}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <Leaf className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          Categorías:{' '}
          <strong className="text-slate-700">
            {DEMAND_CLASS_ORDER.map((c) => DEMAND_CLASS_LABELS[c]).join(' · ')}
          </strong>
        </span>
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          Diagrama del árbol
        </p>
        <TreeDiagram tree={tree} showMetrics={showMetrics} />
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          Reglas en texto
        </p>
        <RuleList nodes={nodes} />
      </div>
    </div>
  );
}
