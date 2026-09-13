/* =========================================================
   Custom icon set. Every glyph is hand-authored SVG geometry
   drawn on a 24x24 grid - no icon fonts, no emoji.
   Icons are applied as CSS masks so they inherit currentColor.
   ========================================================= */

const P = {
  /* fouled anchor */
  anchor: `<circle cx="12" cy="4" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>
           <path d="M12 6.2V21" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
           <path d="M7.6 8.6h8.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
           <path d="M3.8 13.2c0 4.6 3.7 7.8 8.2 7.8s8.2-3.2 8.2-7.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
           <path d="M2 15.4l1.8-2.2 2 1.9M22 15.4l-1.8-2.2-2 1.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,

  /* gunnery crosshair with range ticks */
  target: `<circle cx="12" cy="12" r="7.4" fill="none" stroke="currentColor" stroke-width="1.7"/>
           <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/>
           <path d="M12 1.4v5.2M12 17.4v5.2M1.4 12h5.2M17.4 12h5.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
           <circle cx="12" cy="12" r=".9" fill="currentColor"/>`,

  /* destroyer silhouette */
  ship: `<path d="M1.6 14.6h20.8l-2.4 4.6a1.6 1.6 0 0 1-1.4.8H5.4a1.6 1.6 0 0 1-1.4-.8z" fill="currentColor"/>
         <path d="M6 14.4V11h4.6v3.4M12.6 14.4V9.2h3.4v5.2" fill="none" stroke="currentColor" stroke-width="1.5"/>
         <path d="M8.3 11V5.6M14.3 9.2V4.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
         <path d="M14.3 4.2l4 1.5-4 1.5z" fill="currentColor"/>`,

  /* admiralty crest: shield + crossed cannons + star */
  crest: `<path d="M12 1.4l8.6 3v7.2c0 5-3.6 9-8.6 10.9C7 20.6 3.4 16.6 3.4 11.6V4.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M6.6 8.4l10.8 7.4M17.4 8.4L6.6 15.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M12 6.1l1.24 2.62 2.76.4-2 2.02.47 2.86L12 12.56l-2.47 1.44.47-2.86-2-2.02 2.76-.4z" fill="currentColor"/>`,

  star: `<path d="M12 2.2l2.9 6.1 6.5.94-4.7 4.72 1.11 6.74L12 17.52 6.19 20.7l1.11-6.74L2.6 9.24l6.5-.94z" fill="currentColor"/>`,

  /* signal tower */
  tower: `<path d="M9 21l3-13 3 13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M9.8 17.4h4.4M10.6 13.6h2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="12" cy="5.4" r="1.7" fill="currentColor"/>
          <path d="M7.6 2.4a6.4 6.4 0 0 0 0 6M16.4 2.4a6.4 6.4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  /* chain link */
  link: `<path d="M9.6 14.4a3.9 3.9 0 0 1 0-5.5l2.6-2.6a3.9 3.9 0 0 1 5.5 5.5l-1.3 1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
         <path d="M14.4 9.6a3.9 3.9 0 0 1 0 5.5l-2.6 2.6a3.9 3.9 0 0 1-5.5-5.5l1.3-1.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,

  gear: `<path d="M12 8.4A3.6 3.6 0 1 0 12 15.6 3.6 3.6 0 0 0 12 8.4z" fill="none" stroke="currentColor" stroke-width="1.7"/>
         <path d="M12 1.6l1.5 2.6a8.6 8.6 0 0 1 2.2.9l2.9-.6 1.9 3.3-2 2.2a8.6 8.6 0 0 1 0 2.4l2 2.2-1.9 3.3-2.9-.6a8.6 8.6 0 0 1-2.2.9L12 22.4l-1.5-2.6a8.6 8.6 0 0 1-2.2-.9l-2.9.6-1.9-3.3 2-2.2a8.6 8.6 0 0 1 0-2.4l-2-2.2 1.9-3.3 2.9.6a8.6 8.6 0 0 1 2.2-.9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,

  book: `<path d="M3.4 4.2h5.4c1.8 0 3.2.9 3.2 2.2v13c0-1.3-1.4-2.2-3.2-2.2H3.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
         <path d="M20.6 4.2h-5.4c-1.8 0-3.2.9-3.2 2.2v13c0-1.3 1.4-2.2 3.2-2.2h5.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
         <path d="M12 6.4v13" stroke="currentColor" stroke-width="1.4"/>`,

  eye: `<path d="M1.6 12S5.4 5.6 12 5.6 22.4 12 22.4 12 18.6 18.4 12 18.4 1.6 12 1.6 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="12" cy="12" r="1.1" fill="currentColor"/>`,

  freecam: `<path d="M2.6 7.4h11.2v9.2H2.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M13.8 11l5.4-3.2v8.4L13.8 13z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M5 4.4l1.6 3M9.4 3.8l1.2 3.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <circle cx="21" cy="19" r="1.3" fill="currentColor"/>`,

  flag: `<path d="M5.4 22V2.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
         <path d="M5.4 3.6h13.2l-2.8 4 2.8 4H5.4z" fill="currentColor"/>`,

  users: `<circle cx="8.4" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <path d="M2.4 19.4c0-3.3 2.7-5.4 6-5.4s6 2.1 6 5.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M16 5.2a3.4 3.4 0 0 1 0 6.4M17.2 14.4c2.6.5 4.4 2.4 4.4 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  rules: `<path d="M4.4 2.6h11l4.2 4.2v14.6H4.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M15.4 2.6v4.2h4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M7.6 11h8.8M7.6 14.4h8.8M7.6 17.8h5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  copy: `<path d="M8.4 8.4h11.2v11.2H8.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
         <path d="M15.6 5.6V4.4H4.4v11.2h1.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,

  back: `<path d="M20 12H4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
         <path d="M10.4 5.6L4 12l6.4 6.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,

  close: `<path d="M5.4 5.4l13.2 13.2M18.6 5.4L5.4 18.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,

  check: `<path d="M3.8 12.6l5.4 5.4L20.2 6.4" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,

  rotate: `<path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
           <path d="M20.6 2.6v5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,

  dice: `<path d="M3.6 3.6h16.8v16.8H3.6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
         <circle cx="8.2" cy="8.2" r="1.5" fill="currentColor"/>
         <circle cx="15.8" cy="8.2" r="1.5" fill="currentColor"/>
         <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
         <circle cx="8.2" cy="15.8" r="1.5" fill="currentColor"/>
         <circle cx="15.8" cy="15.8" r="1.5" fill="currentColor"/>`,

  trash: `<path d="M3.8 6.4h16.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M6.4 6.4l1 13.2h9.2l1-13.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M9.4 6.4V3.6h5.2v2.8M10.2 10v6M13.8 10v6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,

  speaker: `<path d="M4 9.2h3.6L13 4.6v14.8L7.6 14.8H4z" fill="currentColor"/>
            <path d="M16.2 9a4.2 4.2 0 0 1 0 6M18.8 6.2a8 8 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,

  display: `<path d="M2.4 4.4h19.2v12.2H2.4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M8 20.4h8M12 16.6v3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            <path d="M5.4 13.6l3.4-4 2.6 2.8 3-4.2 4.2 5.4z" fill="currentColor"/>`,

  hand: `<path d="M9 11V4.8a1.5 1.5 0 0 1 3 0V11M12 11V3.6a1.5 1.5 0 0 1 3 0V11M15 11.4V6a1.5 1.5 0 0 1 3 0v8.4c0 3.9-2.7 6.8-6.4 6.8-2.4 0-4-1-5.2-2.8L4 14.6a1.6 1.6 0 0 1 2.5-2l2.5 2.6V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
};

const VIEWBOX = '0 0 24 24';

const cache = new Map();

export function iconDataURI(name) {
  if (cache.has(name)) return cache.get(name);
  const body = P[name];
  if (!body) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" fill="none">${body}</svg>`;
  const uri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  cache.set(name, uri);
  return uri;
}

/** Paint every [data-icon] element found inside root (or the whole document). */
export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconPainted === el.dataset.icon) return;
    const uri = iconDataURI(el.dataset.icon);
    if (!uri) return;
    el.style.webkitMaskImage = uri;
    el.style.maskImage = uri;
    el.dataset.iconPainted = el.dataset.icon;
  });
}

/** Standalone coloured SVG markup (used for the favicon and any inline art). */
export function iconSVG(name, { size = 24, color = 'currentColor' } = {}) {
  const body = P[name];
  if (!body) return '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${VIEWBOX}" fill="none" style="color:${color}">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(P);
