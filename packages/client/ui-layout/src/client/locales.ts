/** `layout` namespace dictionaries: the desktop caption band (window controls). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'window.minimize': '最小化',
  'window.maximize': '最大化',
  'window.restore': '还原',
  'window.close': '关闭',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
} satisfies Record<LayoutKey, string>
