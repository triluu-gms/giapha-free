'use client';

import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exportFileName, exportTree, type ExportFormat } from '@/lib/exportTree';
import { computeTreeLayout, NODE_H, NODE_W, type LayoutOptions, type Point } from '@/lib/treeLayout';
import type { PersonSummary, TreeData } from '@/lib/types';
import { useI18n } from './I18nProvider';
import Icon from './Icon';
import { useDates } from './useDates';

/** Room around a chi's people inside its frame (more on top, for its name). */
const CHI_PAD = 18;
const CHI_LABEL = 30;

/** A card shows only a person's summary; their other details load when they're clicked. */
type PersonNodeData = { person: PersonSummary; selected: boolean; kinship?: string; isMe?: boolean };
type PersonNode = Node<PersonNodeData, 'person'>;
type ChiNode = Node<{ label: string }, 'chi'>;
type FlowNode = PersonNode | ChiNode;
type PathEdge = Edge<{ points: Point[] }, 'path'>;

function PersonCard({ data }: NodeProps<PersonNode>) {
  const { person, selected, kinship, isMe } = data;
  const { t, formatName } = useI18n();
  const { formatLifespan } = useDates(); // lunar years when the tree uses âm lịch
  const classes = ['person-node', `gender-${person.gender ?? 'unknown'}`];
  if (selected) classes.push('selected');
  if (isMe) classes.push('is-me');
  if (person.deathDate) classes.push('deceased');
  if (kinship) classes.push('has-kinship');
  return (
    <div className={classes.join(' ')} style={{ width: NODE_W, height: NODE_H }}>
      {kinship && (
        <span className="kinship-badge" title={`Cách xưng hô: ${kinship}`}>
          {kinship}
        </span>
      )}
      {isMe && <span className="me-marker">{t('person.you')}</span>}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className="person-node-name">{formatName(person)}</div>
      <div className="person-node-years">{formatLifespan(person)}</div>
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

/** A chi's light frame and name, behind its people (wrapped layout). */
function ChiFrame({ data }: NodeProps<ChiNode>) {
  return (
    <div className="chi-frame">
      <span className="chi-label">{data.label}</span>
    </div>
  );
}

/** A polyline with rounded corners. */
function roundedPath(points: Point[], radius = 8): string {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [p, c, n] = [points[i - 1], points[i], points[i + 1]];
    const lenIn = Math.hypot(c.x - p.x, c.y - p.y);
    const lenOut = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(radius, lenIn / 2, lenOut / 2);
    if (!r) {
      d += ` L ${c.x} ${c.y}`;
      continue;
    }
    const a = { x: c.x + ((p.x - c.x) / lenIn) * r, y: c.y + ((p.y - c.y) / lenIn) * r };
    const b = { x: c.x + ((n.x - c.x) / lenOut) * r, y: c.y + ((n.y - c.y) / lenOut) * r };
    d += ` L ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** A line along the path the layout worked out (it knows about stacked columns and wrapped rows). */
function LayoutPath({ data, style }: EdgeProps<PathEdge>) {
  return <BaseEdge path={roundedPath(data?.points ?? [])} style={style} />;
}

const nodeTypes = { person: PersonCard, chi: ChiFrame };
const edgeTypes = { path: LayoutPath };

/** Turns the computed layout (see lib/treeLayout.ts) into React Flow nodes and edges. */
function layout(
  data: TreeData,
  options: LayoutOptions,
  screenRatio: number,
  chiLabel: (index: number, rootId: string) => string,
): { nodes: FlowNode[]; edges: PathEdge[] } {
  const { positions, links, couples, chi } = computeTreeLayout(data, options, screenRatio);

  const nodes: FlowNode[] = [
    ...chi.map(
      (c, i): ChiNode => ({
        id: c.id,
        type: 'chi',
        position: { x: c.x - CHI_PAD, y: c.y - CHI_LABEL },
        width: c.width + CHI_PAD * 2,
        height: c.height + CHI_LABEL + CHI_PAD,
        data: { label: chiLabel(i, c.root) },
        selectable: false,
        focusable: false,
        draggable: false,
        zIndex: -1,
      }),
    ),
    ...data.nodes.map(
      (person): PersonNode => ({
        id: person.id,
        type: 'person',
        position: positions.get(person.id) ?? { x: 0, y: 0 },
        // The card's fixed size, so bounds (fit view, export) are right even before measuring.
        width: NODE_W,
        height: NODE_H,
        data: { person, selected: false },
      }),
    ),
  ];

  const edges: PathEdge[] = [
    ...links.map(
      (link): PathEdge => ({
        id: link.id,
        source: link.source,
        target: link.target,
        type: 'path',
        data: { points: link.points },
        style: { stroke: 'var(--edge)', strokeWidth: 1.5 },
      }),
    ),
    ...couples.map(
      (c): PathEdge => ({
        id: c.id,
        source: c.source,
        target: c.target,
        type: 'path',
        data: { points: c.points },
        style: { stroke: 'var(--spouse)', strokeWidth: 2, strokeDasharray: '6 4' },
      }),
    ),
  ];

  return { nodes, edges };
}

/** The view's width / height, rounded so small resizes don't lay the tree out again. */
function useScreenRatio() {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) setRatio(Math.round((width / height) * 4) / 4);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, ratio };
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

/** Title and subtitle printed above an exported image or PDF. */
export interface ExportInfo {
  title: string;
  subtitle: string;
}

/** "Download PNG / PDF" buttons. Exports every node shown, not just what fits on screen. */
function ExportPanel({ info }: { info: ExportInfo }) {
  const { t } = useI18n();
  // The instance's getNodesBounds uses React Flow's measured node sizes. (The standalone
  // getNodesBounds only sees our controlled node objects, which have no `measured` size,
  // so it treated every card as 0×0 and the export cut off the right and bottom cards.)
  const { getNodes, getNodesBounds } = useReactFlow();
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(format: ExportFormat) {
    const viewport = panel.current?.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__viewport');
    const nodes = getNodes();
    if (!viewport || !nodes.length) return;
    setBusy(format);
    setError(null);
    try {
      await exportTree({
        viewport,
        bounds: getNodesBounds(nodes),
        format,
        title: info.title,
        subtitle: info.subtitle,
        fileName: exportFileName(info.title),
      });
    } catch (err) {
      setError(t('tree.exportFailed', { error: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel position="top-right">
      <div ref={panel} className="export-panel" role="group" aria-label={t('tree.download')}>
        <span className="muted small">{t('tree.download')}</span>
        <button className="btn" onClick={() => run('png')} disabled={!!busy} title={t('tree.downloadPngTitle')}>
          <Icon name="download" />
          {busy === 'png' ? t('tree.exporting') : t('tree.downloadPng')}
        </button>
        <button className="btn" onClick={() => run('pdf')} disabled={!!busy} title={t('tree.downloadPdfTitle')}>
          <Icon name="download" />
          {busy === 'pdf' ? t('tree.exporting') : t('tree.downloadPdf')}
        </button>
      </div>
      {error && <p className="error small export-error">{error}</p>}
    </Panel>
  );
}

interface Props {
  data: TreeData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** personId -> kinship term relative to the selected person. */
  kinship?: Map<string, string> | null;
  /** Shows the download buttons; the title and subtitle go above the exported tree. */
  exportInfo?: ExportInfo;
  /** The viewer's own person ("This is me"), marked on their card. */
  meId?: string | null;
  /** Direction and compacting options (see lib/treeLayout.ts). */
  layoutOptions: LayoutOptions;
}

export default function FamilyTree({ data, selectedId, onSelect, kinship, exportInfo, meId, layoutOptions }: Props) {
  const { t, formatName } = useI18n();
  const { ref, ratio } = useScreenRatio();
  const { nodes, edges } = useMemo(() => {
    if (ratio === null) return { nodes: [], edges: [] };
    const byId = new Map(data.nodes.map((p) => [p.id, p]));
    const chiLabel = (i: number, rootId: string) => {
      const root = byId.get(rootId);
      return t('tree.chiLabel', { n: i + 1, name: root ? formatName(root) : '' });
    };
    return layout(data, layoutOptions, ratio, chiLabel);
  }, [data, layoutOptions, ratio, t, formatName]);
  // Cards whose selection, kinship label and "me" mark are unchanged keep the same
  // node object, so React Flow re-renders only the cards that changed on a click.
  const shown = useRef(new Map<string, PersonNode>());
  const displayNodes = useMemo(() => {
    const previous = shown.current;
    const next = new Map<string, PersonNode>();
    const result = nodes.map((n): FlowNode => {
      if (n.type !== 'person') return n;
      const selected = n.id === selectedId;
      const label = kinship?.get(n.id);
      const isMe = n.id === meId;
      const old = previous.get(n.id);
      const node =
        old && old.position === n.position && old.data.person === n.data.person &&
        old.data.selected === selected && old.data.kinship === label && old.data.isMe === isMe
          ? old
          : { ...n, data: { ...n.data, selected, kinship: label, isMe } };
      next.set(n.id, node);
      return node;
    });
    shown.current = next;
    return result;
  }, [nodes, selectedId, kinship, meId]);
  // Remount (and re-fit the viewport) when the people, the layout options or the view's shape change.
  const viewKey = useMemo(
    () => hash([data.nodes.map((n) => n.id).sort().join('|'), JSON.stringify(layoutOptions), ratio].join('#')),
    [data, layoutOptions, ratio],
  );

  return (
    <div ref={ref} className="family-tree">
      {ratio !== null && (
        <ReactFlow
          key={viewKey}
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => node.type === 'person' && onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
          minZoom={0.05}
          colorMode="system"
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          {exportInfo && <ExportPanel info={exportInfo} />}
          <MiniMap
            pannable
            zoomable
            nodeClassName={(n) =>
              n.type === 'chi' ? 'chi' : (n.data as PersonNodeData).person.deathDate ? 'deceased' : ''
            }
          />
        </ReactFlow>
      )}
    </div>
  );
}
