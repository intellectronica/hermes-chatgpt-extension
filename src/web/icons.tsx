import type { ReactNode, SVGProps } from 'react';

export type IconName = 'hermes' | 'new' | 'menu' | 'close' | 'send' | 'stop' | 'chat' | 'clock' | 'copy' | 'check' | 'chevron' | 'refresh' | 'sun' | 'moon' | 'arrow';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    hermes: <><path d="M5 7.5 8.5 4 12 7.5 15.5 4 19 7.5v9L15.5 20 12 16.5 8.5 20 5 16.5z" /><path d="M8.5 4v9L12 16.5l3.5-3.5V4M5 7.5l3.5 3.5L12 7.5l3.5 3.5L19 7.5" /></>,
    new: <><path d="m16 3 5 5-10 10-6 1 1-6zM14 5l5 5" /><path d="M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5" /></>,
    menu: <><path d="M4 5h16v14H4zM9 5v14" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    send: <path d="M12 20V4m-7 7 7-7 7 7" />,
    stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
    chat: <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2V11.5A7.5 7.5 0 0 1 10.5 4h2a7.5 7.5 0 0 1 7.5 7.5Z" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.3 6.3A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.7 5.7" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    moon: <path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5 8.5 8.5 0 1 0 20.5 13.2Z" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
