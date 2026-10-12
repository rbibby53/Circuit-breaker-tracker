import type { TopologyKind } from '@cbt/core';

/** Line icons for the things on the power-flow map: utility, panels, generators, switches. */
export function NodeIcon({ kind, size = 24 }: { kind: TopologyKind; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'utility': // a transmission tower
      return (
        <svg {...common}>
          <path d="M12 2 7 22M12 2l5 20M5 7h14M7 12h10M8.5 16l7 0M6 22h12M9 7l6 5M15 7l-6 5" />
        </svg>
      );
    case 'generator':
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="19" height="13" rx="2" />
          <path d="M13 8.5 9.5 13h4l-2.5 4M6 19v2M18 19v2" />
        </svg>
      );
    case 'ats': // two sources meeting in one
      return (
        <svg {...common}>
          <path d="M5 3v5a4 4 0 0 0 4 4h3M19 3v5a4 4 0 0 1-4 4h-3M12 12v9" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
        </svg>
      );
    case 'relay':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M7 8h2l4-2M7 12h2l4-2M7 16h2l4-2M15 8h2M15 12h2M15 16h2" />
        </svg>
      );
    case 'hidden':
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    default: // a breaker panel
      return (
        <svg {...common}>
          <rect x="4" y="2.5" width="16" height="19" rx="2" />
          <path d="M8 7h3M13 7h3M8 11h3M13 11h3M8 15h3M13 15h3" />
        </svg>
      );
  }
}
