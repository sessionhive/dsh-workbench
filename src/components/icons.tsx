import type { ReactNode } from 'react';
import type { IconName } from '../types';

const paths: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  minus: <path d="M5 12h14" />,
  square: <rect x="5.5" y="5.5" width="13" height="13" rx="1.8" />,
  restore: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
      <path d="M15.5 5.5H7A1.5 1.5 0 0 0 5.5 7v8.5" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 10.8 13.2" />
      <path d="M21.5 2.5 14.8 21.4l-4-8.6-8.6-4Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  pen: (
    <>
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 7.5 3 3" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      <path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  command: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
    </>
  ),
  activity: <path d="M22 12h-4l-3 8-6-16-3 8H2" />,
  layers: (
    <>
      <path d="m12 2.5 9.5 5L12 12.5l-9.5-5Z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 17.5 9.5 5 9.5-5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 20v-6M4 10V4M12 20v-9M12 7V4M20 20v-4M20 12V4" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="9" r="2" />
      <circle cx="20" cy="14" r="2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2.2-.9 2.2-2 0-.6-.3-1-.5-1.4-.2-.4-.4-.7-.4-1.2 0-1 .8-1.7 1.8-1.7h1.4A4.5 4.5 0 0 0 21 10.2 7.4 7.4 0 0 0 12 3Z" />
      <circle cx="7.5" cy="10.5" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="14.5" cy="7" r="1" />
      <circle cx="17" cy="10" r="1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5Z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0Z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  arrowUpRight: <path d="M7 17 17 7M8 7h9v9" />,
  pause: <path d="M9.5 5v14M14.5 5v14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: (
    <>
      <path d="M10.3 3.9 2.5 17.4A1.8 1.8 0 0 0 4.1 20h15.8a1.8 1.8 0 0 0 1.6-2.6L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 16.5h.01" />
    </>
  ),
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  ),
  panel: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </>
  ),
  neuron: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="m7 7.4 3 3M17 7.4l-3 3M7 16.6l3-3M17 16.6l-3-3" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M3.5 10h17" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21M12 3c-2.5 2.6-3.8 5.6-3.8 9S9.5 18.4 12 21" />
    </>
  ),
  arrowLeft: <path d="M19 12H5m6-7-7 7 7 7" />,
  arrowRight: <path d="M5 12h14m-6-7 7 7-7 7" />,
  home: (
    <>
      <path d="m3.5 11 8.5-7 8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="7.5" width="16" height="11.5" rx="3" />
      <path d="M12 7.5V5" />
      <circle cx="12" cy="3.6" r="1.1" />
      <circle cx="9" cy="12.5" r="1" />
      <circle cx="15" cy="12.5" r="1" />
      <path d="M9.5 16h5" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 2.8c3.2 1.9 4.8 4.9 4.8 9L12 15.5 7.2 11.8c0-4.1 1.6-7.1 4.8-9Z" />
      <circle cx="12" cy="8.2" r="1.7" />
      <path d="M7.6 12.6 5.8 18l4.4-1.9M16.4 12.6 18.2 18l-4.4-1.9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 19 6v5.6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6Z" />
      <path d="m9 11.8 2.1 2.1L15.3 10" />
    </>
  ),
  wrench: (
    <path d="M14.7 3.6a5.1 5.1 0 0 0-6.6 6.2l-4.3 4.3a2.1 2.1 0 0 0 3 3l4.3-4.3a5.1 5.1 0 0 0 6.2-6.6L14.8 8.7l-1.9-.6-.6-1.9Z" />
  ),
  bug: (
    <>
      <rect x="7.5" y="7" width="9" height="12" rx="4.5" />
      <path d="M9.5 7V5.8A1.8 1.8 0 0 1 11.3 4h1.4a1.8 1.8 0 0 1 1.8 1.8V7M3.5 9h4M16.5 9h4M3.5 14h4M16.5 14h4M5 19l3-2M19 19l-3-2M12 9.5V16" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.6A2.6 2.6 0 0 1 6.6 3H20v15.5H6.6A2.6 2.6 0 0 0 4 21.1Z" />
      <path d="M4 5.6v15.5M8 7.5h8M8 11h6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 16.5v-4.5M12 16.5V8M16 16.5v-3M19.5 16.5V6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1Z" />
    </>
  ),
  cloud: (
    <path d="M7.2 18h9.6a4.2 4.2 0 0 0 .6-8.4A6.2 6.2 0 0 0 5.7 11 3.5 3.5 0 0 0 7.2 18Z" />
  ),
  git: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M18 10a8 8 0 0 1-8 8" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9.5 3 2.8-3 2.8M12.5 15.2H17" />
    </>
  ),
  wand: (
    <>
      <path d="M4.5 19.5 15 9l2.5-2.5" />
      <path d="M14.5 3v3.2M19.4 5.8l-2.2 2.2M21 11h-3.2M18.6 15.6l-2.2-2.2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4.5 17.5 4.6-4.4 3.6 3.2 2.3-2.1 4.5 4.3" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="16" r="3.5" />
      <path d="m10 13.5 9.5-9.5M16.5 4h3.5v3.5M15 5.5 17.8 8.3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  cube: (
    <>
      <path d="m12 2.8 8.3 4.7v9L12 21.2l-8.3-4.7v-9Z" />
      <path d="M3.7 7.5 12 12.2l8.3-4.7M12 12.2v9" />
    </>
  ),
  orbit: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <ellipse cx="12" cy="12" rx="9.2" ry="4.4" transform="rotate(-28 12 12)" />
      <circle cx="20" cy="7.7" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  wave: <path d="M2.5 12h3.2l2.1-5.6 3.4 11.2 2.8-8.4 2.1 2.8h5.4" />,
  pin: (
    <>
      <path d="M9.2 3.5h5.6l-.7 5.1 3.1 3.2-.7 1.9H7.5l-.7-1.9 3.1-3.2Z" />
      <path d="M12 13.7v6.8" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
