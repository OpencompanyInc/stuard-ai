import React, { useRef, useEffect, useState, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import {
    LayoutGrid,
    MessageSquare,
    StickyNote,
    Terminal,
    Settings,
    Music,
    Image as ImageIcon,
    Cpu,
    Zap
} from 'lucide-react';

const ITEM_SIZE = 90; 
const GAP = 40;
const RADIUS = 1200; // Flatter, wider curve for a more panoramic feel
const PERSPECTIVE = 2000;

// Launcher items with actions and icons
const LAUNCHER_ITEMS = [
    {
        id: 'overlay',
        label: 'Stuard',
        icon: MessageSquare,
        color: 'hsl(220, 100%, 65%)',
        action: () => {
            try { (window as any).desktopAPI?.show?.(); } catch { }
        }
    },
    {
        id: 'automations',
        label: 'Automations',
        icon: Zap,
        color: 'hsl(35, 100%, 60%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('Automations', 'Opening automations...'); } catch { }
        }
    },
    {
        id: 'workspace',
        label: 'Workflows',
        icon: LayoutGrid,
        color: 'hsl(280, 90%, 65%)',
        action: () => {
            try { (window as any).desktopAPI?.openWorkflows?.(); } catch { }
        }
    },
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: Terminal,
        color: 'hsl(160, 80%, 50%)',
        action: () => {
            try { (window as any).desktopAPI?.openDashboard?.(); } catch { }
        }
    },
    {
        id: 'notes',
        label: 'Notes',
        icon: StickyNote,
        color: 'hsl(45, 90%, 60%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('Notes', 'Notes feature coming soon!'); } catch { }
        }
    },
    {
        id: 'music',
        label: 'Music',
        icon: Music,
        color: 'hsl(320, 80%, 60%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('Music', 'Music player coming soon!'); } catch { }
        }
    },
    {
        id: 'gallery',
        label: 'Gallery',
        icon: ImageIcon,
        color: 'hsl(200, 90%, 60%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('Gallery', 'Gallery feature coming soon!'); } catch { }
        }
    },
    {
        id: 'system',
        label: 'System',
        icon: Cpu,
        color: 'hsl(200, 20%, 60%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('System', 'System monitor...'); } catch { }
        }
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        color: 'hsl(0, 0%, 70%)',
        action: () => {
            try { (window as any).desktopAPI?.notify?.('Settings', 'Settings coming soon!'); } catch { }
        }
    },
];

export function CurvedHud() {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollX = useMotionValue(0);
    const smoothScrollX = useSpring(scrollX, {
        damping: 30,
        stiffness: 200,
        mass: 1
    });

    const [activeIndex, setActiveIndex] = useState(0);

    // Snap to nearest item logic
    const snapToItem = useCallback((targetIndex: number) => {
        const clampedIndex = Math.max(0, Math.min(LAUNCHER_ITEMS.length - 1, targetIndex));
        setActiveIndex(clampedIndex);

        // Calculate the scroll position needed to center this item
        const centerIndex = (LAUNCHER_ITEMS.length - 1) / 2;
        const targetScroll = (centerIndex - clampedIndex) * (ITEM_SIZE + GAP);
        scrollX.set(targetScroll);
    }, [scrollX]);

    // Handle Wheel Scrolling
    useEffect(() => {
        let timeout: NodeJS.Timeout;
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const sensitivity = 1.2;
            const current = scrollX.get();
            const delta = e.deltaX + e.deltaY;
            const newVal = current - delta * sensitivity;

            const maxScroll = (LAUNCHER_ITEMS.length * (ITEM_SIZE + GAP)) / 2 + 200;
            if (newVal > maxScroll) scrollX.set(maxScroll);
            else if (newVal < -maxScroll) scrollX.set(-maxScroll);
            else scrollX.set(newVal);

            clearTimeout(timeout);
            timeout = setTimeout(() => {
                const currentScroll = scrollX.get();
                const centerIndex = (LAUNCHER_ITEMS.length - 1) / 2;
                const fractionalIndex = centerIndex - (currentScroll / (ITEM_SIZE + GAP));
                const roundedIndex = Math.round(fractionalIndex);
                snapToItem(roundedIndex);
            }, 60);
        };

        window.addEventListener('wheel', handleWheel, { passive: false });
        return () => window.removeEventListener('wheel', handleWheel);
    }, [scrollX, snapToItem]);

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                try { window.close(); } catch { }
            }
            if (e.key === 'ArrowRight') {
                snapToItem(activeIndex + 1);
            }
            if (e.key === 'ArrowLeft') {
                snapToItem(activeIndex - 1);
            }
            if (e.key === 'Enter' || e.key === ' ') {
                const item = LAUNCHER_ITEMS[activeIndex];
                item?.action();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex, snapToItem]);

    // Mount effect to center initial
    useEffect(() => {
        snapToItem(1); // Default to Workflows or second item
        setTimeout(() => snapToItem(0), 100); // Small animation on mount
    }, []);

    return (
        <div
            className="fixed bottom-0 left-0 right-0 flex items-end justify-center pointer-events-none z-50 overflow-visible"
            style={{ height: '450px' }}
        >
            {/* 3D Perspective Container */}
            <div
                ref={containerRef}
                className="relative w-full h-full flex items-end justify-center pb-24"
                style={{
                    perspective: `${PERSPECTIVE}px`,
                    perspectiveOrigin: '50% 50%',
                }}
            >
                {/* Ring container - Tilted */}
                <div
                    className="relative flex items-center justify-center transform-gpu"
                    style={{
                        transformStyle: 'preserve-3d',
                        transform: 'rotateX(-5deg) translateY(0px)', 
                    }}
                >
                    {LAUNCHER_ITEMS.map((item, index) => (
                        <LauncherItem
                            key={item.id}
                            item={item}
                            index={index}
                            scrollX={smoothScrollX}
                            totalItems={LAUNCHER_ITEMS.length}
                            isActive={index === activeIndex}
                            onClick={() => snapToItem(index)}
                        />
                    ))}
                </div>
            </div>

            {/* Subtle Vignette / Ambient Shadow - Cleaner gradient */}
            <div className="fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/60 to-transparent pointer-events-none -z-10" />
        </div>
    );
}

interface LauncherItemProps {
    item: { id: string; label: string; padding?: string; color: string; action: () => void; icon: any };
    index: number;
    scrollX: any;
    totalItems: number;
    isActive: boolean;
    onClick: () => void;
}

function LauncherItem({ item, index, scrollX, totalItems, isActive, onClick }: LauncherItemProps) {
    const centerIndex = (totalItems - 1) / 2;
    const baseOffset = (index - centerIndex) * (ITEM_SIZE + GAP);
    const Icon = item.icon;

    const arcPosition = useTransform(scrollX, (scroll: number) => {
        return baseOffset + scroll;
    });

    const transform3D = useTransform(arcPosition, (pos: number) => {
        const angle = pos / RADIUS; // Angle in radians
        const x = RADIUS * Math.sin(angle);
        const z = RADIUS * (Math.cos(angle) - 1);
        const rotateY = -angle * (180 / Math.PI); // Face center

        return `translateX(${x}px) translateZ(${z}px) rotateY(${rotateY}deg)`;
    });

    const opacity = useTransform(arcPosition, (pos: number) => {
        const angle = Math.abs(pos / RADIUS);
        if (angle > Math.PI / 3) return 0;
        return Math.max(0, 1 - Math.pow(angle / (Math.PI / 3.5), 2));
    });

    const scale = useTransform(arcPosition, (pos: number) => {
        const angle = Math.abs(pos / RADIUS);
        // Smoother scale curve
        return Math.max(0.6, 1.3 - (angle * 0.9));
    });

    const brightness = useTransform(arcPosition, (pos: number) => {
        const angle = Math.abs(pos / RADIUS);
        return Math.max(0.2, 1 - angle * 1.5);
    });

    // Vertical offset to follow curve
    const yOffset = useTransform(arcPosition, (pos: number) => {
        const angle = Math.abs(pos / RADIUS);
        return Math.abs(angle) * 20; 
    });

    return (
        <motion.div
            onClick={() => {
                onClick();
                if (isActive) item.action();
            }}
            className="absolute flex flex-col items-center justify-center rounded-[28px] cursor-pointer pointer-events-auto select-none group"
            style={{
                width: ITEM_SIZE,
                height: ITEM_SIZE,
                transform: transform3D,
                y: yOffset,
                opacity: opacity,
                scale: scale,
                background: isActive 
                    ? 'rgba(20, 20, 25, 0.6)' 
                    : 'rgba(20, 20, 25, 0.3)',
                backdropFilter: 'blur(16px)',
                border: isActive 
                    ? '1px solid rgba(255,255,255,0.15)' 
                    : '1px solid rgba(255,255,255,0.05)',
                boxShadow: isActive 
                    ? `0 20px 40px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.1), 0 0 30px ${item.color}20`
                    : `0 10px 20px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.02)`,
            }}
            whileHover={{
                scale: 1.35,
                zIndex: 50,
                background: 'rgba(30, 30, 35, 0.7)',
                borderColor: 'rgba(255,255,255,0.2)',
                boxShadow: `0 30px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 40px ${item.color}30`
            }}
            whileTap={{ scale: 1.15 }}
            transition={{
                type: "spring",
                stiffness: 400,
                damping: 30
            }}
        >
            {/* Icon Container */}
            <div 
                className={`relative z-10 p-3 rounded-2xl transition-all duration-300 flex items-center justify-center`}
            >
                <Icon
                    size={40}
                    color={item.color}
                    strokeWidth={isActive ? 2 : 1.5}
                    style={{
                        filter: isActive 
                            ? `drop-shadow(0 0 12px ${item.color}60)` 
                            : 'none',
                        transition: 'all 0.3s ease'
                    }}
                />
            </div>

            {/* Label - Elegant Pill */}
            <motion.div
                className="absolute -bottom-14 text-center pointer-events-none"
                style={{ opacity: brightness }}
            >
                <div
                    className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wider uppercase bg-black/80 backdrop-blur-xl border border-white/10 text-white/90 shadow-2xl transition-all duration-300 transform ${isActive ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-2 scale-90'}`}
                >
                    {item.label}
                </div>
            </motion.div>

            {/* Active Indicator Dot */}
            <div 
                className={`absolute -bottom-3 w-1.5 h-1.5 rounded-full bg-white/80 shadow-[0_0_10px_white] transition-all duration-300 ${isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-0'}`}
            />

            {/* Reflection / Gloss Top */}
            <div className="absolute top-0 left-0 right-0 h-2/3 bg-gradient-to-b from-white/10 to-transparent rounded-t-[28px] pointer-events-none opacity-40" />
            
            {/* Subtle bottom glow */}
            <div 
                className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-white/5 to-transparent rounded-b-[28px] pointer-events-none opacity-30"
            />
        </motion.div>
    );
}
