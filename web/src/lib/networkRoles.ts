import type { NetworkRole } from '@manelly/shared';

/** The roles an interface of the Jellyfin server can have, in this order everywhere. */
export const NETWORK_ROLES: ReadonlyArray<{ role: NetworkRole; label: string; hint: string }> = [
  { role: 'streaming', label: 'Streaming', hint: 'Zu den Geräten, auf denen Jellyfin abspielt' },
  { role: 'management', label: 'Management', hint: 'Zur Verwaltung, z. B. Manelly und der Zugriff von deinem Computer' },
  { role: 'storage', label: 'Storage', hint: 'Zum Speicher (z. B. NAS), auf dem die Filme liegen – Manelly zeigt sie bei den Umwandlungen' },
];

export const roleLabel = (role: NetworkRole) => NETWORK_ROLES.find((entry) => entry.role === role)?.label ?? role;
