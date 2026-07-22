"use client";

import { useRef, useEffect, useState } from "react";
import { useScroll, useTransform, useMotionValueEvent } from "framer-motion";

const FRAME_COUNT = 120; // frame_000 to frame_119
// ponytail: basePath-prefixed — public assets aren't auto-prefixed for manual img.src.
// Must match basePath in next.config.ts.
const FRAME_PREFIX = "/portfolio/sequence/frame_";
const FRAME_SUFFIX = "_delay-0.067s.webp";

export default function ScrollyCanvas() {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imagesRef = useRef<HTMLImageElement[]>([]);
    const rafPending = useRef(false);
    const [loaded, setLoaded] = useState(false);

    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    const frameIndex = useTransform(scrollYProgress, [0, 1], [0, FRAME_COUNT - 1]);

    const drawImage = (index: number) => {
        const canvas = canvasRef.current;
        const img = imagesRef.current[index];
        if (!canvas || !img || !img.complete || img.naturalWidth === 0) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // object-fit: cover
        const canvasAspect = canvas.width / canvas.height;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        let renderWidth, renderHeight, xOffset, yOffset;
        if (canvasAspect > imgAspect) {
            renderWidth = canvas.width;
            renderHeight = canvas.width / imgAspect;
            xOffset = 0;
            yOffset = (canvas.height - renderHeight) / 2;
        } else {
            renderHeight = canvas.height;
            renderWidth = canvas.height * imgAspect;
            yOffset = 0;
            xOffset = (canvas.width - renderWidth) / 2;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, xOffset, yOffset, renderWidth, renderHeight);
    };

    // Preload AND decode every frame up front, so drawing during scroll never
    // triggers a synchronous main-thread decode (the cause of the stutter).
    useEffect(() => {
        let cancelled = false;
        const imgs: HTMLImageElement[] = [];
        for (let i = 0; i < FRAME_COUNT; i++) {
            const img = new Image();
            img.src = `${FRAME_PREFIX}${i.toString().padStart(3, "0")}${FRAME_SUFFIX}`;
            imgs.push(img);
            img
                .decode()
                .then(() => {
                    if (cancelled) return;
                    // Reveal as soon as the first frame is decode-ready; the rest
                    // keep decoding in the background.
                    if (i === 0) {
                        setLoaded(true);
                        drawImage(0);
                    }
                })
                .catch(() => { /* frame missing — skip, previous frame stays */ });
        }
        imagesRef.current = imgs;
        return () => { cancelled = true; };
    }, []);

    // Size the canvas and redraw the current frame on mount + resize.
    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            drawImage(Math.round(frameIndex.get()));
        };
        window.addEventListener("resize", handleResize);
        handleResize();
        return () => window.removeEventListener("resize", handleResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    // Coalesce scroll updates into one draw per repaint (never more than 1/frame).
    useMotionValueEvent(frameIndex, "change", () => {
        if (rafPending.current) return;
        rafPending.current = true;
        requestAnimationFrame(() => {
            rafPending.current = false;
            drawImage(Math.round(frameIndex.get()));
        });
    });

    return (
        <div ref={containerRef} className="h-[500vh] w-full relative">
            <div className="sticky top-0 h-screen w-full overflow-hidden">
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

                {!loaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#050505] z-50">
                        <p className="text-white text-sm font-medium animate-pulse tracking-widest uppercase">
                            Loading Sequence...
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
