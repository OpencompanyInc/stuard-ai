import React, { useMemo, useState, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useResizeDetector } from 'react-resize-detector';
import { clsx } from 'clsx';

interface Entity {
  id: string;
  name: string;
  type: string;
  summary: string;
  created_at: string;
  x?: number;
  y?: number;
}

interface Link {
  source: string | Entity;
  target: string | Entity;
  value: number; // Similarity
}

interface PinboardProps {
  entities: Entity[];
  links: Link[];
  onSelectEntity: (entity: Entity) => void;
  selectedEntity: Entity | null;
}

export function Pinboard({ entities, links, onSelectEntity, selectedEntity }: PinboardProps) {
  const { width, height, ref } = useResizeDetector();
  const graphRef = useRef<any>();

  const typeColors: Record<string, string> = {
    project: '#854d0e', // Dark Yellow
    person: '#9f1239', // Dark Pink
    company: '#1e40af', // Dark Blue
    tool: '#166534', // Dark Green
    topic: '#431407', // Dark Red/Brown for Topics (Titles)
  };

  const stickyNoteColors: Record<string, string> = {
    project: '#fef9c3', // light yellow
    person: '#ffe4e6', // light pink
    company: '#dbeafe', // light blue
    tool: '#dcfce7', // light green
    topic: '#ffedd5', // light orange
  };

  const nodeCanvasObject = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const entity = node as Entity;
    const label = entity.name;
    const isSelected = selectedEntity?.id === entity.id;
    const isTopic = entity.type === 'topic';

    // dimensions
    const w = isTopic ? 200 : 160;
    const h = isTopic ? 60 : 100;

    ctx.save();
    ctx.translate(node.x, node.y);

    // Glow
    ctx.shadowBlur = (isSelected ? 30 : 15) / globalScale;
    ctx.shadowColor = isTopic ? 'rgba(239, 68, 68, 0.4)' : 'rgba(0, 0, 0, 0.3)';

    if (isTopic) {
      // Glowy Topic Card
      const grad = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      grad.addColorStop(0, '#222');
      grad.addColorStop(1, '#000');
      ctx.fillStyle = grad;
      ctx.strokeStyle = isSelected ? '#ef4444' : 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 2 / globalScale;

      ctx.beginPath();
      // @ts-ignore
      if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 12 / globalScale);
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.font = `bold ${22 / globalScale}px "Inter", "Stuard", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(label.toUpperCase(), 0, 0);
    } else {
      // Premium Sticky
      ctx.fillStyle = stickyNoteColors[entity.type] || '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.lineWidth = 1 / globalScale;

      ctx.beginPath();
      // @ts-ignore
      if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 12 / globalScale);
      else ctx.rect(-w / 2, -h / 2, w, h);
      ctx.fill();
      ctx.stroke();

      // Pin
      ctx.shadowBlur = 5 / globalScale;
      ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 10 / globalScale, 6 / globalScale, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#111';
      ctx.font = `${isSelected ? '900' : '700'} ${15 / globalScale}px "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const words = label.split(' ');
      let line = '';
      let y = -h / 2 + 30 / globalScale;
      const maxWidth = w - 20;
      const lineHeight = 18 / globalScale;

      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
          ctx.fillText(line, 0, y);
          line = words[n] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 0, y);

      ctx.font = `italic ${10 / globalScale}px "Inter", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.textAlign = 'right';
      ctx.fillText(entity.type.toUpperCase(), w / 2 - 10 / globalScale, h / 2 - 12 / globalScale);
    }

    if (isSelected && !isTopic) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4 / globalScale;
      ctx.strokeRect(-w / 2 - 2 / globalScale, -h / 2 - 2 / globalScale, w + 4 / globalScale, h + 4 / globalScale);
    }

    ctx.restore();
  };

  return (
    <div ref={ref} className="w-full h-full relative overflow-hidden bg-[#0d0d0f]"
      style={{
        backgroundImage: `
             radial-gradient(circle at 50% 50%, #1a1a20 0%, #0d0d0f 100%)
           `,
      }}>

      {width && height && (
        <ForceGraph2D
          ref={graphRef}
          width={width}
          height={height}
          graphData={{ nodes: entities, links }}
          nodeLabel="name"
          nodeCanvasObject={nodeCanvasObject}
          nodeCanvasObjectMode={() => 'replace'}
          onNodeClick={(node: any) => onSelectEntity(node as Entity)}

          // Red String Links
          linkColor={() => 'rgba(239, 68, 68, 0.6)'}
          linkWidth={2}
          linkCurvature={0.2}

          // Physics Configuration
          linkDistance={(link: any) => {
            const val = link.value || 0.5;
            return 300 * (1.2 - val);
          }}
          d3VelocityDecay={0.4}
          warmupTicks={100}
          cooldownTicks={0}

          enableNodeDrag={true}
          backgroundColor="transparent"
        />
      )}

      {/* Legend */}
      <div className="absolute bottom-8 right-8 p-6 bg-black/40 backdrop-blur-2xl border border-white/5 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all hover:scale-[1.02] hover:bg-black/50 group">
        <div className="font-black text-white/90 border-b border-white/10 pb-3 mb-4 text-[11px] tracking-[0.3em] uppercase text-center font-stuard">
          Topic Hub
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-[10.5px] text-white/60 font-black">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-[0_0_15px_rgba(59,130,246,0.5)]"></span>
            PROJECTS
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-gradient-to-br from-rose-400 to-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.5)]"></span>
            PEOPLE
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 shadow-[0_0_15px_rgba(99,102,241,0.5)]"></span>
            COMPANIES
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.5)]"></span>
            TOOLS
          </div>
          <div className="flex items-center gap-3 col-span-2 mt-2 py-2 px-4 bg-white/5 rounded-xl border border-white/10">
            <span className="w-4 h-4 rounded-lg bg-[#1a1a1a] border-2 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]"></span>
            <span className="text-white/90 tracking-widest ml-1">TOPIC NODES</span>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-white/5 text-[9px] text-white/30 font-black text-center tracking-[0.25em] group-hover:text-red-500/50 transition-colors">
          NEURAL STRINGS CONNECTED
        </div>
      </div>
    </div>
  );
}
