// Host side of the remote buzzer. The host and the buzzer page meet on a public MQTT broker
// over secure WebSocket, using the 4-character room code as the topic. No account or server of
// ours is involved, and it works on networks that block direct device-to-device links.
// The buzzer only sends "team N pressed"; all game rules still run in the host's engine.

import { CONFIG } from './config.js';
import { buzzStatus } from './state.js';

const BROKERS = CONFIG.brokers;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes
export const topics = (code) => ({ up: `${CONFIG.topicPrefix}/${code}/up`, down: `${CONFIG.topicPrefix}/${code}/down` });

const makeCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/** Connects to the first reachable broker. Calls onUp(client, url) or onFail(). */
export function connectBroker(onUp, onFail, onDrop) {
  let i = 0;
  const tryNext = () => {
    if (i >= BROKERS.length) return onFail();
    const url = BROKERS[i++];
    if (!window.mqtt) return onFail();
    const client = window.mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 6000, clean: true });
    let up = false;
    client.on('connect', () => {
      up = true;
      client.removeAllListeners('close');
      client.on('close', () => onDrop?.(client));
      onUp(client, url);
    });
    const fail = () => {
      if (up) return;
      client.end(true);
      tryNext();
    };
    client.once('error', fail);
    client.once('close', fail);
  };
  tryNext();
}

/**
 * @param {{ getState: () => object, onBuzz: (team: number) => void, onChange: (info: object) => void }} opts
 */
export function createRemote({ getState, onBuzz, onChange }) {
  let client = null;
  let code = null;
  let error = null;
  let open = false;
  let timer = null;
  const seen = new Map(); // buzzer id -> last time we heard from it

  const live = () => [...seen.values()].filter((t) => Date.now() - t < 12000).length;
  const info = () => ({ code, open, count: live(), error });

  const send = () => client?.connected && client.publish(topics(code).down, JSON.stringify(buzzStatus(getState())), { qos: 1 });

  /** Call after every state change. */
  const push = () => open && send();

  function start() {
    if (open || client) return;
    if (!window.mqtt) {
      error = 'Could not load the messaging library (are you online?).';
      return onChange(info());
    }
    code = makeCode();
    error = null;
    onChange(info());
    connectBroker(
      (c) => {
        client = c;
        open = true;
        c.subscribe(topics(code).up, { qos: 1 });
        c.on('message', (_t, buf) => {
          let m;
          try {
            m = JSON.parse(buf.toString());
          } catch {
            return;
          }
          if (m?.id) seen.set(m.id, Date.now());
          if (m?.type === 'buzz' && (m.team === 0 || m.team === 1)) onBuzz(m.team);
          if (m?.type === 'hello' || m?.type === 'buzz') send();
          onChange(info());
        });
        timer = setInterval(() => onChange(info()), 4000);
        onChange(info());
      },
      () => {
        error = 'Could not reach a message broker. Check the laptop’s internet connection.';
        code = null;
        onChange(info());
      },
      () => {
        if (!open) return;
        error = 'Lost the connection to the broker. Close the room and open it again.';
        onChange(info());
      },
    );
  }

  function stop() {
    clearInterval(timer);
    client?.end(true);
    client = null;
    open = false;
    code = null;
    error = null;
    seen.clear();
    onChange(info());
  }

  const url = () => (code ? new URL(`buzzer.html?room=${code}`, location.href).href : '');

  return { start, stop, push, info, url };
}
