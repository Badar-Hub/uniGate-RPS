import type { TransportType } from '@unigate/types';
import { goodsPlugin } from '@/modules/goods/plugin.js';
import { passengerPlugin } from '@/modules/passenger/plugin.js';
import type { VerticalPlugin } from '@/verticals/plugin.js';

/** The only place both verticals are named. Core modules resolve through here (ADR-010 §7). */
const PLUGINS: Readonly<Record<TransportType, VerticalPlugin>> = { PASSENGER: passengerPlugin, GOODS: goodsPlugin };

export function verticalFor(type: TransportType): VerticalPlugin {
  return PLUGINS[type];
}

export function enabledVerticals(): TransportType[] {
  return (Object.keys(PLUGINS) as TransportType[]).filter((t) => PLUGINS[t].enabled);
}
