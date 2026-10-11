"use client";

import { useEffect, useState } from "react";

/**
 * Reveals text a few characters at a time, like an answer being given.
 * Mount it with a `key` per answer. The full text is laid out invisibly from
 * the first frame, so nothing below it moves while it types. Screen readers
 * get the whole answer at once, and so does anyone who asked for reduced motion.
 */
export function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let n = 0;
    const timer = window.setInterval(() => {
      n = reduce ? text.length : Math.min(text.length, n + 4);
      setShown(n);
      if (n >= text.length) window.clearInterval(timer);
    }, 16);
    return () => window.clearInterval(timer);
  }, [animate, text]);

  if (shown >= text.length) return <>{text}</>;
  return (
    <span className="relative block">
      <span className="sr-only">{text}</span>
      <span aria-hidden className="invisible">
        {text}
      </span>
      <span aria-hidden className="absolute inset-0">
        {text.slice(0, shown)}
        <span className="ml-px inline-block h-[1em] w-px translate-y-0.5 bg-accent" />
      </span>
    </span>
  );
}
