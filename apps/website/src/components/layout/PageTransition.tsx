'use client';

import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { usePathname } from 'next/navigation';

const transition: Transition = {
    duration: 0.55,
    ease: [0.22, 1, 0.36, 1],
};

const variants = {
    initial: {
        opacity: 0,
        y: 24,
        filter: 'blur(8px)',
    },
    animate: {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
    },
    exit: {
        opacity: 0,
        y: -16,
        filter: 'blur(6px)',
    },
};

/**
 * Animates each route as it mounts/unmounts. Pairs with the Lenis smooth-scroll
 * provider — we use `mode="wait"` so the outgoing page finishes its exit
 * before the next page slides up, which lines up nicely with the scroll-to-top
 * reset on route change.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={pathname}
                initial="initial"
                animate="animate"
                exit="exit"
                variants={variants}
                transition={transition}
                style={{ willChange: 'transform, opacity, filter' }}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
}
