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
    const [images, setImages] = useState<HTMLImageElement[]>([]);
    const [loaded, setLoaded] = useState(false);

    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start start", "end end"],
    });

    const frameIndex = useTransform(scrollYProgress, [0, 1], [0, FRAME_COUNT - 1]);

    useEffect(() => {
        // Preload all images in parallel
        const loadImages = () => {
            const imgArray: HTMLImageElement[] = [];
            let loadedCount = 0;

            for (let i = 0; i < FRAME_COUNT; i++) {
                const img = new Image();
                const paddedIndex = i.toString().padStart(3, "0");

                img.onload = () => {
                    loadedCount++;
                    // Hide loading screen as soon as frame 0 is loaded, or at least 5 frames are loaded
                    if (i === 0 || loadedCount >= 5) {
                        setLoaded(true);
                    }
                };
                img.onerror = () => {
                    console.error(`Failed to load image index ${paddedIndex}`);
                };

                img.src = `${FRAME_PREFIX}${paddedIndex}${FRAME_SUFFIX}`;
                imgArray.push(img);
            }
            setImages(imgArray);
        };

        loadImages();
    }, []);

    const drawImage = (index: number) => {
        if (!canvasRef.current || !images[index] || !loaded) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const img = images[index];

        // Ensure image data is fully loaded before drawing to avoid canvas errors
        if (!img.complete || img.naturalWidth === 0) return;

        // Handle object-fit: cover logic mathematically
        const canvasAspect = canvas.width / canvas.height;
        const imgAspect = img.width / img.height;

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

    // Initialize canvas size and draw first frame on mound
    useEffect(() => {
        const handleResize = () => {
            if (canvasRef.current) {
                // Set canvas to internal resolving resolution of the window
                canvasRef.current.width = window.innerWidth;
                canvasRef.current.width = window.innerWidth;
                canvasRef.current.height = window.innerHeight;
                // Draw the current frame immediately after resize
                drawImage(Math.round(frameIndex.get()));
            }
        };

        window.addEventListener("resize", handleResize);
        handleResize(); // trigger once to setup

        return () => window.removeEventListener("resize", handleResize);
    }, [loaded]);

    // Redraw when scroll updates the frame index
    useMotionValueEvent(frameIndex, "change", (latest) => {
        drawImage(Math.round(latest));
    });

    return (
        <div ref={containerRef} className="h-[500vh] w-full relative">
            <div className="sticky top-0 h-screen w-full overflow-hidden">
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                />

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
