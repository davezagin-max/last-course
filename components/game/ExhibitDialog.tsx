"use client";

import { useEffect, useRef } from "react";
import { factText } from "@/lib/case/explain";
import type { Names } from "@/lib/case/public";
import { PLACE_AT, type Evidence } from "@/lib/case/types";

/** One exhibit in full: its text, and exactly what it proves. Native <dialog>, so focus and Escape just work. */
export function ExhibitDialog({
  exhibit,
  names,
  onClose,
}: {
  exhibit: Evidence | null;
  names: Names;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (exhibit && !dialog.open) dialog.showModal();
    if (!exhibit && dialog.open) dialog.close();
  }, [exhibit]);

  const proves = exhibit?.facts.filter((f) => f.type !== "motive") ?? [];
  const motive = exhibit?.facts.find((f) => f.type === "motive");

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby="exhibit-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      {exhibit && (
        <div className="flex flex-col gap-4 p-6">
          <div>
            <p className="label">
              Exhibit{exhibit.foundAt ? ` · found ${PLACE_AT[exhibit.foundAt]}` : ""}
            </p>
            <h2 id="exhibit-title" className="font-display text-2xl leading-tight">
              {exhibit.title}
            </h2>
          </div>
          <p className="leading-relaxed">{exhibit.detail}</p>
          {(proves.length > 0 || motive) && (
            <div className="rounded-md border border-border bg-raised px-3 py-2.5">
              <p className="label mb-1.5">What it proves</p>
              <ul className="flex flex-col gap-1 text-sm">
                {proves.map((fact, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                    {factText(names, fact)}
                  </li>
                ))}
                {motive && motive.type === "motive" && (
                  <li className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-accent" />
                    {motive.holds
                      ? "Supports a motive. Check the accusation sheet."
                      : "Rules out a motive. Check the accusation sheet."}
                  </li>
                )}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-raised"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
