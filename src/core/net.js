/* =========================================================
   Peer-to-peer transport over PeerJS.
   Host generates a short battle code; the challenger dials it.
   Everything above this layer speaks in {t: type, ...payload}.
   ========================================================= */

const ID_PREFIX = 'bs3d-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const CODE_LEN = 6;

export function makeCode(len = CODE_LEN) {
  let s = '';
  const buf = new Uint32Array(len);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export class Net extends EventTarget {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
    this.open = false;
    this.ping = null;
    this._pingTimer = null;
    this._pendingPing = 0;
    this._destroyed = false;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /* ---------------- lifecycle ---------------- */

  async host() {
    this.isHost = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        await this._createPeer(ID_PREFIX + code);
        this.code = code;
        this.emit('ready', { code });
        this._listen();
        return code;
      } catch (err) {
        if (err && err.type === 'unavailable-id' && attempt < 3) continue;
        throw err;
      }
    }
    throw new Error('Could not reserve a battle code.');
  }

  async join(rawCode) {
    this.isHost = false;
    const code = normalizeCode(rawCode);
    if (code.length < 4) throw new Error('That battle code looks too short.');
    await this._createPeer(null);
    this.code = code;
    this.emit('ready', { code });

    const conn = this.peer.connect(ID_PREFIX + code, {
      reliable: true,
      serialization: 'json',
      metadata: { v: 1 },
    });
    this._bindConn(conn);

    // PeerJS stays silent when the remote id simply does not exist.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.open) {
          try { conn.close(); } catch { /* noop */ }
          reject(new Error('No answer from that battle code.'));
        }
      }, 14000);
      const onOpen = () => { clearTimeout(timer); this.removeEventListener('connected', onOpen); resolve(); };
      this.addEventListener('connected', onOpen);
      this.addEventListener('failed', (e) => { clearTimeout(timer); reject(new Error(e.detail?.message || 'Link failed.')); }, { once: true });
    });
  }

  _createPeer(id) {
    return new Promise((resolve, reject) => {
      if (typeof window.Peer !== 'function') {
        reject(new Error('PeerJS did not load. Check your connection and reload.'));
        return;
      }
      const peer = id ? new window.Peer(id, PEER_OPTS) : new window.Peer(PEER_OPTS);
      let settled = false;

      peer.on('open', () => {
        if (settled) return;
        settled = true;
        this.peer = peer;
        resolve(peer);
      });

      peer.on('error', (err) => {
        if (!settled) {
          settled = true;
          try { peer.destroy(); } catch { /* noop */ }
          reject(err);
          return;
        }
        this._onPeerError(err);
      });

      peer.on('disconnected', () => {
        if (this._destroyed) return;
        // The signalling socket dropped; data channels may still be alive.
        try { peer.reconnect(); } catch { /* noop */ }
      });
    });
  }

  _onPeerError(err) {
    const fatal = ['network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id', 'peer-unavailable'];
    const msg = friendlyPeerError(err);
    if (err && fatal.includes(err.type) && !this.open) {
      this.emit('failed', { message: msg, type: err.type });
    } else {
      this.emit('warn', { message: msg, type: err?.type });
    }
  }

  _listen() {
    this.peer.on('connection', (conn) => {
      if (this.conn && this.open) {
        // Only one challenger per engagement.
        try { conn.close(); } catch { /* noop */ }
        return;
      }
      this._bindConn(conn);
    });
  }

  _bindConn(conn) {
    this.conn = conn;

    conn.on('open', () => {
      this.open = true;
      this.emit('connected', { peer: conn.peer });
      this._startPing();
    });

    conn.on('data', (raw) => {
      let msg = raw;
      if (typeof raw === 'string') {
        try { msg = JSON.parse(raw); } catch { return; }
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === '__ping') { this.send('__pong', { at: msg.at }); return; }
      if (msg.t === '__pong') {
        this.ping = Math.round(performance.now() - msg.at);
        this.emit('ping', { ping: this.ping });
        return;
      }
      this.emit('message', msg);
    });

    conn.on('close', () => {
      if (this._destroyed) return;
      this.open = false;
      this._stopPing();
      this.emit('closed', {});
    });

    conn.on('error', (err) => {
      this.emit('warn', { message: friendlyPeerError(err) });
    });
  }

  /* ---------------- messaging ---------------- */

  send(type, payload = {}) {
    if (!this.conn || !this.open) return false;
    try {
      this.conn.send({ t: type, ...payload });
      return true;
    } catch (err) {
      console.warn('[net] send failed', err);
      return false;
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (!this.open) return;
      this.send('__ping', { at: performance.now() });
    }, 3000);
    this.send('__ping', { at: performance.now() });
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  destroy() {
    this._destroyed = true;
    this._stopPing();
    this.open = false;
    try { this.conn && this.conn.close(); } catch { /* noop */ }
    try { this.peer && this.peer.destroy(); } catch { /* noop */ }
    this.conn = null;
    this.peer = null;
  }
}

/* Public PeerJS cloud broker + public STUN. No custom server needed. */
const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    ],
  },
};

export function friendlyPeerError(err) {
  const t = err && err.type;
  switch (t) {
    case 'peer-unavailable': return 'No fleet is waiting on that battle code.';
    case 'unavailable-id':   return 'That battle code is already in use.';
    case 'network':          return 'Lost contact with the signalling relay.';
    case 'server-error':     return 'The signalling relay is not answering.';
    case 'socket-error':
    case 'socket-closed':    return 'The signalling socket closed unexpectedly.';
    case 'browser-incompatible': return 'This browser does not support WebRTC data channels.';
    case 'webrtc':           return 'WebRTC could not open a direct channel.';
    default: return (err && err.message) || 'Unknown link error.';
  }
}

/** Read ?join=CODE from the URL so invite links work. */
export function codeFromURL() {
  try {
    const u = new URL(window.location.href);
    const c = u.searchParams.get('join') || u.searchParams.get('code');
    return c ? normalizeCode(c) : null;
  } catch { return null; }
}

export function inviteURL(code) {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', code);
  return u.toString();
}
