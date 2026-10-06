export function BrandMark({ size = 19, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth={7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M42 18 L18 50 L42 82" />
      <path d="M58 18 L82 50 L58 82" />
      <path d="M44 54 L50 63 L58 41" />
    </svg>
  );
}
