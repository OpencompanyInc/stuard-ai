import React, { useState } from 'react';
import { Check, Copy, Palette } from 'lucide-react';
import clsx from 'clsx';

export interface ColorItem {
  hex: string;
  name?: string;
}

export interface ColorPaletteProps {
  colors: ColorItem[];
  title?: string;
}

const getContrastColor = (hex: string): string => {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? '#000000' : '#ffffff';
};

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  colors,
  title
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (hex: string, index: number) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {}
  };

  return (
    <div className="w-full max-w-md my-3">
      {title && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <Palette className="w-4 h-4 text-neutral-400" />
          <span className="text-xs font-medium text-neutral-600">{title}</span>
        </div>
      )}
      
      <div className="flex rounded-xl overflow-hidden shadow-sm border border-neutral-200">
        {colors.map((color, idx) => {
          const contrastColor = getContrastColor(color.hex);
          const isCopied = copiedIndex === idx;
          
          return (
            <button
              key={idx}
              onClick={() => handleCopy(color.hex, idx)}
              className={clsx(
                "flex-1 min-w-[60px] h-24 flex flex-col items-center justify-end p-2 transition-all relative group",
                "hover:flex-[1.2] hover:shadow-lg hover:z-10"
              )}
              style={{ backgroundColor: color.hex }}
              title={`Copy ${color.hex}`}
            >
              {/* Hover overlay */}
              <div 
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                style={{ backgroundColor: `${color.hex}dd` }}
              >
                {isCopied ? (
                  <Check className="w-5 h-5" style={{ color: contrastColor }} />
                ) : (
                  <Copy className="w-4 h-4" style={{ color: contrastColor }} />
                )}
              </div>
              
              {/* Color info */}
              <div className="relative z-10 text-center">
                {color.name && (
                  <div 
                    className="text-[10px] font-medium mb-0.5 opacity-80"
                    style={{ color: contrastColor }}
                  >
                    {color.name}
                  </div>
                )}
                <div 
                  className="text-xs font-mono font-medium uppercase"
                  style={{ color: contrastColor }}
                >
                  {color.hex}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Click hint */}
      <div className="mt-2 text-center">
        <span className="text-[10px] text-neutral-400">
          Click to copy hex code
        </span>
      </div>
    </div>
  );
};


