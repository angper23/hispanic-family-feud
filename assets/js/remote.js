// Host side of the remote buzzer. The host opens a PeerJS room (WebRTC, no server of ours);
// the buzzer page (buzzer.html) joins it with the room code, usually on an iPad.
// The buzzer only sends "team N pressed"; all game rules still run in the host's engine.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes
export const PREFIX = 'hff-';

/** STUN for direct links, plus a public TURN relay as a fallback for networks that block peer-to-peer. */
export const PEER_OPTIONS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

const makeCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/**
 * @param {{ getState: () => object, onBuzz: (team: number) => void, onChange: (info: object) => void }} opts
 */
export function createRemote({ getState, onBuzz, onChange }) {
  let peer = null;
  let code = null;
  const conns = new Set();
  let error = null;

  const info = () => ({ code, open: !!peer, count: conns.size, error });

  function status() {
    const s = getState();
    const fo = s.faceoff;
    const armed = s.phase === 'faceoff' && !!s.questionShown && fo?.buzzed == null && !(fo?.attempts?.length);
    return {
      type: 'status',
      armed,
      buzzed: s.phase === 'faceoff' ? (fo?.buzzed ?? null) : null,
      phase: s.phase,
      names: s.teams.map((t) => t.name),
    };
  }

  /** Call after every state change. */
  function push() {
    if (!conns.size) return;
    const msg = status();
    conns.forEach((c) => c.open && c.send(msg));
  }

  function wire(conn) {
    conn.on('open', () => {
      conns.add(conn);
      conn.send(status());
      onChange(info());
    });
    conn.on('data', (m) => {
      if (m?.type === 'buzz' && (m.team === 0 || m.team === 1)) onBuzz(m.team);
      else if (m?.type === 'hello') conn.send(status());
    });
    const drop = () => {
      conns.delete(conn);
      onChange(info());
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  function start(attempt = 0) {
    if (peer) return;
    if (typeof window.Peer !== 'function') {
      error = 'Could not load the PeerJS library (are you online?).';
      return onChange(info());
    }
    code = makeCode();
    const p = new window.Peer(PREFIX + code, PEER_OPTIONS);
    peer = p;
    error = null;
    p.on('open', () => onChange(info()));
    p.on('connection', wire);
    p.on('disconnected', () => {
      if (!p.destroyed) p.reconnect();
    });
    p.on('error', (e) => {
      if (e.type === 'unavailable-id' && attempt < 5) {
        p.destroy();
        peer = null;
        return start(attempt + 1);
      }
      error = `Connection problem: ${e.type}`;
      onChange(info());
    });
    onChange(info());
  }

  function stop() {
    conns.forEach((c) => c.close());
    conns.clear();
    peer?.destroy();
    peer = null;
    code = null;
    error = null;
    onChange(info());
  }

  const url = () => (code ? new URL(`buzzer.html?room=${code}`, location.href).href : '');

  return { start, stop, push, info, url };
}
