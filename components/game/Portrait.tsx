/**
 * A suspect's portrait: their monogram on a plate. Drawn, not photographed,
 * so every generated case gets portraits for free.
 */
export function Portrait({
  monogram,
  size = 56,
  active = false,
  className = "",
}: {
  monogram: string;
  size?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {/* Rim, well, and a knife-edge highlight: a plate seen from above. */}
      <circle
        cx="32"
        cy="32"
        r="30.5"
        fill={active ? "var(--accent)" : "var(--raised)"}
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <circle
        cx="32"
        cy="32"
        r="23"
        fill="none"
        stroke={active ? "var(--accent-fg)" : "var(--accent)"}
        strokeOpacity={active ? 0.55 : 0.45}
        strokeWidth="1"
      />
      <path
        d="M 12 26 A 21 21 0 0 1 26 12"
        fill="none"
        stroke={active ? "var(--accent-fg)" : "var(--accent)"}
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-display)"
        fontSize="20"
        fontWeight="700"
        letterSpacing="0.5"
        fill={active ? "var(--accent-fg)" : "var(--fg)"}
      >
        {monogram.slice(0, 2)}
      </text>
    </svg>
  );
}
