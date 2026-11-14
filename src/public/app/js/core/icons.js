import { $ } from './dom.js';

/* ============= Íconos estilo iOS (SVG línea fina, sin dependencias) =============
   Emojis se reservan para acentos con personalidad (saludo, badges); la
   navegación y los controles de la interfaz usan este set, más consistente
   y "nativo" que un emoji a distintos tamaños/plataformas. */
const ICONS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1H9z"/><path d="M9 11h6M9 15h6"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5V3Z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M3 20h18"/>',
  message: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  cap: '<path d="M2 9 12 4l10 5-10 5-10-5Z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/><path d="M21 9v6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c2.5.4 4.5 2.6 4.5 5.3"/>',
  pulse: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  chevronLeft: '<path d="M15 5 8 12l7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  link: '<path d="M9 12a3.5 3.5 0 0 0 5 3l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M15 12a3.5 3.5 0 0 0-5-3l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  trash: '<path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M14 8l5 4-5 4"/><path d="M19 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 13 4 4 10-10"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  bell: '<path d="M7 9a5 5 0 0 1 10 0v4l1.5 3h-13L7 13Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M7 9a5 5 0 0 1 10 0v4l1.5 3h-13L7 13Z"/><path d="M10 19a2 2 0 0 0 4 0"/><path d="m4 4 16 16"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
  send: '<path d="M4.5 12 20 4.5 15 20l-3.5-5.5L4.5 12Z"/><path d="m11.5 14.5 3.5-6"/>',
  note: '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M15 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  tag: '<path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5A1.5 1.5 0 0 1 5 19.5Z"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14a2 2 0 0 1 2-2h2v7H6a2 2 0 0 1-2-2Z"/><path d="M20 14a2 2 0 0 0-2-2h-2v7h2a2 2 0 0 0 2-2Z"/><path d="M16 19c0 1.1-.9 2-2 2h-2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  funnel: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  shield: '<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6Z"/><path d="m9 12 2 2 4-4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
  activity: '<path d="M4 19V9M10 19V5M16 19v-7M3 19h18"/><path d="m4 7 6-4 6 7 4-3"/>',
  report: '<path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M15 3v5h4M9 17v-3M12 17v-6M15 17v-2"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeOff: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M15 11.2c3.4.3 6 1.4 6 2.8v4c0 1.7-2.7 3-6 3-1.9 0-3.6-.4-4.7-1.1"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1M15 13v1M9 17h6"/><circle cx="12" cy="3.5" r="1"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14.2-1.5 6.8 5-2.5 5 2.5-1.5-6.8"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6Z"/>',
  building: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6M3 21h18"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8c-1.5-3-5-4-5-1.5S10 8 12 8c2 0 5-.5 5-1.5S13.5 5 12 8Z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l8 5V5L7 10H4a1 1 0 0 0-1 1Z"/><path d="M19 9a4 4 0 0 1 0 6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V12"/><path d="M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2-3.5a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};

/* Los emojis de la interfaz (estados, filas de contacto, acciones) se dibujan
   con el mismo set de íconos: heredan el color del texto y escalan con él. Un
   emoji sin equivalente se deja tal cual. Los mensajes de WhatsApp no pasan
   por aquí: su contenido se muestra como lo escribió la persona. */
const EMOJI_ICONO = {
  '💬': 'message', '🔍': 'search', '🔄': 'refresh', '⛔': 'ban', '📱': 'phone', '📲': 'phone', '📞': 'phone',
  '🔗': 'link', '🗂': 'folder', '⏰': 'clock', '⌛': 'hourglass', '⏳': 'hourglass', '📧': 'mail', '✉': 'mail',
  '📨': 'send', '🎓': 'cap', '⭐': 'star', '✖': 'x', '✅': 'check', '✓': 'check', '📅': 'calendar', '🗓': 'calendar',
  '💰': 'coins', '💡': 'note', '🔒': 'lock', '🔐': 'lock', '👤': 'user', '👥': 'users', '📊': 'chart',
  '📋': 'clipboard', '🧾': 'receipt', '🔑': 'key', '🤖': 'bot', '➕': 'plus', '✏': 'pencil', '🎧': 'headset',
  '🗑': 'trash', '🎯': 'target', '📣': 'megaphone', '🔔': 'bell', '📝': 'note', '📄': 'note', '🙋': 'hand',
  '🥇': 'award', '🥈': 'award', '🥉': 'award', '🏫': 'building', '🧭': 'compass', '📚': 'book', '🎒': 'book',
  '🎁': 'gift', '💳': 'card', '⚠': 'alert', '💤': 'moon', '📭': 'inbox', '📶': 'pulse',
};
function iconoDeEmoji(caracter, size = '1em') {
  const nombre = EMOJI_ICONO[String(caracter ?? '').replace(/\uFE0F/g, '').trim()];
  return nombre ? icon(nombre, size) : null;
}

function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="icon-svg" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

export { ICONS, icon, iconoDeEmoji };
