"use client";

import { useEffect, useRef } from "react";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A single decorative fish that quietly travels through the shared app frame. */
export function TunaSwimmer() {
  const swimmerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const swimmer = swimmerRef.current;
    if (!swimmer) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) {
      swimmer.dataset.reducedMotion = "true";
      return;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const pointer = { x: viewport.width * 0.55, y: viewport.height * 0.42, active: false, lastMove: 0 };
    const size = { width: swimmer.offsetWidth || 64, height: swimmer.offsetHeight || 40 };
    const margin = { x: 18, top: 76, bottom: 26 };
    let x = viewport.width * 0.16;
    let y = viewport.height * 0.25;
    let velocityX = 0.7;
    let velocityY = 0.08;
    let targetX = x + viewport.width * 0.34;
    let targetY = y;
    let chaseUntil = 0;
    let nextDecision = performance.now() + 6500;
    let animationFrame = 0;

    const measure = () => {
      const rect = swimmer.getBoundingClientRect();
      if (rect.width > 0) size.width = rect.width;
      if (rect.height > 0) size.height = rect.height;
    };

    const bounds = () => ({
      maxX: Math.max(margin.x, viewport.width - size.width - margin.x - (viewport.width > 1023 ? 112 : 0)),
      maxY: Math.max(margin.top, viewport.height - size.height - margin.bottom - (viewport.width <= 1023 ? 78 : 0)),
    });

    const chooseCruiseTarget = () => {
      const { maxX, maxY } = bounds();
      targetX = margin.x + Math.random() * Math.max(1, maxX - margin.x);
      targetY = margin.top + Math.random() * Math.max(1, maxY - margin.top);
    };

    const resize = () => {
      viewport.width = window.innerWidth;
      viewport.height = window.innerHeight;
      measure();
      const { maxX, maxY } = bounds();
      x = clamp(x, margin.x, maxX);
      y = clamp(y, margin.top, maxY);
      targetX = clamp(targetX, margin.x, maxX);
      targetY = clamp(targetY, margin.top, maxY);
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      pointer.lastMove = performance.now();
    };

    const tick = (now: number) => {
      if (document.hidden) {
        animationFrame = requestAnimationFrame(tick);
        return;
      }

      if (now >= nextDecision) {
        const pointerIsRecent = pointer.active && now - pointer.lastMove < 2600;
        if (pointerIsRecent && Math.random() < 0.48) {
          chaseUntil = now + 2600 + Math.random() * 1800;
        } else {
          chaseUntil = 0;
          chooseCruiseTarget();
        }
        nextDecision = now + 7000 + Math.random() * 9000;
      }

      if (now < chaseUntil) {
        targetX = pointer.x - size.width * 0.52;
        targetY = pointer.y - size.height * 0.5;
      }

      const { maxX, maxY } = bounds();
      targetX = clamp(targetX, margin.x, maxX);
      targetY = clamp(targetY, margin.top, maxY);
      const deltaX = targetX - x;
      const deltaY = targetY - y;
      const distance = Math.hypot(deltaX, deltaY);

      if (distance < 28 && now >= chaseUntil) chooseCruiseTarget();

      velocityX += deltaX * 0.00065;
      velocityY += deltaY * 0.00065;
      velocityX *= 0.991;
      velocityY *= 0.991;
      const speed = Math.hypot(velocityX, velocityY);
      if (speed > 1.45) {
        velocityX = (velocityX / speed) * 1.45;
        velocityY = (velocityY / speed) * 1.45;
      } else if (speed < 0.32) {
        const nudge = distance > 0 ? 0.04 : 0;
        velocityX += (deltaX / Math.max(1, distance)) * nudge;
        velocityY += (deltaY / Math.max(1, distance)) * nudge;
      }

      x += velocityX;
      y += velocityY;
      if (x <= margin.x || x >= maxX) velocityX *= -0.86;
      if (y <= margin.top || y >= maxY) velocityY *= -0.86;
      x = clamp(x, margin.x, maxX);
      y = clamp(y, margin.top, maxY);

      swimmer.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scaleX(${velocityX < 0 ? -1 : 1})`;
      animationFrame = requestAnimationFrame(tick);
    };

    resize();
    chooseCruiseTarget();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <div ref={swimmerRef} className="tuna-swimmer" aria-hidden="true">
      <div className="tuna-swimmer__sprite">
        <svg className="tuna-swimmer__svg" viewBox="0 0 180 96" focusable="false">
          <path className="tuna-swimmer__tail" d="M49 48C36 35 23 29 10 27c7 12 9 23 1 41 14-5 27-9 39-14Z" fill="#2b6e82" stroke="#b3d4dc" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M45 47c3-18 27-29 59-29 29 0 50 10 65 29-12 20-35 31-65 31-31 0-54-10-59-31Z" fill="#557f91" stroke="#d6e8eb" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M58 54c12 10 30 15 52 14 23-1 41-8 53-20-7 17-29 29-60 30-21 0-37-6-45-16Z" fill="#335c70" opacity=".72" />
          <path d="M84 20c3-9 10-13 18-10l10 10" fill="#3d7082" stroke="#c7e1e5" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M91 73c5 8 14 11 23 5l-5-11" fill="#3d7082" stroke="#c7e1e5" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M133 36c7 4 11 9 14 15-7 0-13-2-18-6" fill="#416f7f" stroke="#c7e1e5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M125 30c6 4 10 8 13 13" fill="none" stroke="#d6e8eb" strokeWidth="1.8" strokeLinecap="round" opacity=".72" />
          <path d="M145 46c2 5 2 10 0 15" fill="none" stroke="#d6e8eb" strokeWidth="2" strokeLinecap="round" opacity=".8" />
          {/* The tail is on the left, so the head (and eye) faces right. */}
          <circle cx="146" cy="38" r="6" fill="#e9f4f4" stroke="#163b4b" strokeWidth="2.1" />
          <circle cx="147" cy="38" r="2.5" fill="#163b4b" />
          <path d="M46 47c7 1 10 3 13 7" fill="none" stroke="#d6e8eb" strokeWidth="2" strokeLinecap="round" opacity=".9" />
          <path d="M4 43c-2 0-3 0-4 1M7 51c-3 1-4 2-5 3" fill="none" stroke="#9dcbd4" strokeWidth="2" strokeLinecap="round" opacity=".72" />
        </svg>
      </div>
    </div>
  );
}
