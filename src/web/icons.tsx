import type { SVGProps } from 'react';
import { ArrowRight, ArrowRotateCcw, ArrowUp, Chat, ChatCompose, Check, ChevronRight, Clock, Copy, Moon, PlusComposer, Sidebar, Stop, Sun, X } from '@openai/apps-sdk-ui/components/Icon';

export type IconName = 'plus' | 'new' | 'menu' | 'close' | 'send' | 'stop' | 'chat' | 'clock' | 'copy' | 'check' | 'chevron' | 'refresh' | 'sun' | 'moon' | 'arrow';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const icons = { plus: PlusComposer, new: ChatCompose, menu: Sidebar, close: X, send: ArrowUp, stop: Stop, chat: Chat, clock: Clock, copy: Copy, check: Check, chevron: ChevronRight, refresh: ArrowRotateCcw, sun: Sun, moon: Moon, arrow: ArrowRight };
  const Component = icons[name];
  return <Component width="20" height="20" aria-hidden="true" {...props} />;
}
