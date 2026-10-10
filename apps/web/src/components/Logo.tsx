export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="2" width="20" height="22" rx="2" fill="none" stroke="#F2B705" strokeWidth="2" />
      <path d="M14 6l-4 8h5l-3 6" fill="none" stroke="#F2B705" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
