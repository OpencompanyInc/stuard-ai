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
    
    // Generate a stable random rotation between -3 and 3 degrees
    const seed = entity.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rotation = ((seed % 100) / 100 * 6) - 3;
    
    // Dimensions
    const w = isTopic ? 180 : 140;
    const h = isTopic ? 60 : 100;
    
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.rotate((rotation * Math.PI) / 180);

    // 1. Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10 / globalScale;
    ctx.shadowOffsetX = 4 / globalScale;
    ctx.shadowOffsetY = 4 / globalScale;

    if (isTopic) {
      // Styling for Group/Topic Title (Header style)
      ctx.fillStyle = '#1a1a1a';
      ctx.strokeStyle = '#ef4444'; // Red border
      ctx.lineWidth = 3 / globalScale;
      
      // Draw a "header" or "sign" shape
      ctx.beginPath();
      ctx.roundRect(-w/2, -h/2, w, h, 4 / globalScale);
      ctx.fill();
      ctx.stroke();

      // Title Text
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.font = `bold ${18 / globalScale}px "Stuard", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label.toUpperCase(), 0, 0);

    } else {
      // Styling for Sticky Notes
      ctx.fillStyle = stickyNoteColors[entity.type] || '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1 / globalScale;
      
      ctx.beginPath();
      ctx.rect(-w/2, -h/2, w, h);
      ctx.fill();
      ctx.stroke();

      // "Tape" or "Pin" effect at top
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'; // Red pin
      ctx.beginPath();
      ctx.arc(0, -h/2 + 8, 5 / globalScale, 0, Math.PI * 2);
      ctx.fill();

      // Text
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${isSelected ? 'bold' : ''} ${14 / globalScale}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      
      // Wrap text
      const words = label.split(' ');
      let line = '';
      let y = -h/2 + 25;
      const maxWidth = w - 20;
      const lineHeight = 18 / globalScale;

      for (let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = ctx.measureText(testLine);
        let testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
          ctx.fillText(line, 0, y);
          line = words[n] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 0, y);

      // Type label at bottom
      ctx.font = `italic ${10 / globalScale}px "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.textAlign = 'right';
      ctx.fillText(entity.type.toUpperCase(), w/2 - 5, h/2 - 12);
    }

    if (isSelected) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4 / globalScale;
        ctx.strokeRect(-w/2 - 2, -h/2 - 2, w + 4, h + 4);
    }

    ctx.restore();
  };

  return (
    <div ref={ref} className="w-full h-full relative overflow-hidden bg-[#2c2c2e]" 
         style={{ 
           backgroundImage: `
             radial-gradient(#3a3a3c 1px, transparent 1px)
           `,
           backgroundSize: '30px 30px',
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
      <div className="absolute bottom-6 right-6 p-4 bg-black/40 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl">
        <div className="font-bold text-white border-b border-white/10 pb-2 mb-3 text-[10px] tracking-widest uppercase text-center font-stuard">
            Pinboard
        </div>
        
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-white/60 font-bold">
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#fef9c3]"></span> 
                Projects
            </div>
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#ffe4e6]"></span> 
                People
            </div>
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#dbeafe]"></span> 
                Companies
            </div>
            <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-[#dcfce7]"></span> 
                Tools
            </div>
            <div className="flex items-center gap-2 col-span-2">
                <span className="w-3 h-3 rounded-sm bg-[#1a1a1a] border border-[#ef4444]"></span> 
                Topic Titles
            </div>
        </div>
      </div>
    </div>
  );
}
