'use client';

import { motion, useReducedMotion, type Transition, type Variants } from 'framer-motion';
import { useMemo, type ElementType, type ReactNode } from 'react';

type Direction = 'up' | 'down' | 'left' | 'right' | 'none';

interface SectionRevealProps {
    children: ReactNode;
    as?: ElementType;
    className?: string;
    id?: string;
    /** Distance, in px, of the slide-in offset. Defaults to 40. */
    distance?: number;
    /** Direction the content slides from. Defaults to 'up'. */
    direction?: Direction;
    /** Delay before the animation starts, in seconds. */
    delay?: number;
    /** Duration of the animation, in seconds. Defaults to 0.7. */
    duration?: number;
    /** How much of the element must enter the viewport before animating (0-1). */
    amount?: number;
    /** Play every time the element enters the viewport (default true = once). */
    once?: boolean;
}

const transitionBase: Transition = {
    ease: [0.22, 1, 0.36, 1],
};

const directionOffset = (direction: Direction, distance: number) => {
    switch (direction) {
        case 'up':
            return { x: 0, y: distance };
        case 'down':
            return { x: 0, y: -distance };
        case 'left':
            return { x: distance, y: 0 };
        case 'right':
            return { x: -distance, y: 0 };
        default:
            return { x: 0, y: 0 };
    }
};

/**
 * Drop-in wrapper that fades + slides its children in when they scroll into view.
 * Respects `prefers-reduced-motion`. Use it around marketing sections,
 * cards, headings, anything you want to feel alive.
 */
export default function SectionReveal({
    children,
    as = 'div',
    className,
    id,
    distance = 40,
    direction = 'up',
    delay = 0,
    duration = 0.7,
    amount = 0.2,
    once = true,
}: SectionRevealProps) {
    const reduce = useReducedMotion();
    const offset = directionOffset(direction, distance);

    const variants: Variants = {
        hidden: reduce
            ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)' }
            : { opacity: 0, ...offset, filter: 'blur(8px)' },
        visible: {
            opacity: 1,
            x: 0,
            y: 0,
            filter: 'blur(0px)',
            transition: { ...transitionBase, duration, delay },
        },
    };

    const MotionTag = useMemo(
        () => motion.create(as as React.ElementType),
        [as],
    );

    return (
        <MotionTag
            id={id}
            className={className}
            initial="hidden"
            whileInView="visible"
            viewport={{ once, amount, margin: '0px 0px -10% 0px' }}
            variants={variants}
        >
            {children}
        </MotionTag>
    );
}
