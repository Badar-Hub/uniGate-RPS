import type { TransportType } from '@unigate/types';
import { goodsPlugin } from '@/modules/goods/plugin.js';
import { passengerPlugin } from '@/modules/passenger/plugin.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import type { VerticalPlugin } from '@/verticals/plugin.js';

/** The only place both verticals are named. Core modules resolve through here (ADR-010 §7). */
const PLUGINS: Readonly<Record<TransportType, VerticalPlugin>> = { PASSENGER: passengerPlugin, GOODS: goodsPlugin };

export function verticalFor(type: TransportType): VerticalPlugin {
  return PLUGINS[type];
}

/**
 * A vertical is live when its module is capable (`plugin.enabled`) AND the deployment has switched
 * it on through `platform.verticals_enabled` (ADR-009). Registered vehicles, trips already under
 * way and reads are never gated — only new demand is.
 */
export async function enabledVerticals(): Promise<TransportType[]> {
  const on = await getSettingValue<TransportType[]>('platform.verticals_enabled', ['PASSENGER']);
  return (Object.keys(PLUGINS) as TransportType[]).filter((t) => PLUGINS[t].enabled && on.includes(t));
}

export async function isVerticalEnabled(type: TransportType): Promise<boolean> {
  return (await enabledVerticals()).includes(type);
}
