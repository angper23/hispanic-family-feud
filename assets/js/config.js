// The one place to rebrand this game or change how the remote buzzer connects.
// Fork the repo, edit these values, and every page picks them up.

export const CONFIG = {
  gameName: 'Hispanic Family Feud',
  orgShort: 'S.A.L.S.A.',
  orgFull: 'Student Alliance for Learning, Success and Achievement',
  venue: 'Kutztown University',

  /**
   * Remote buzzer: public MQTT brokers (secure WebSocket), tried in order.
   * topicPrefix keeps your rooms apart from other copies of this project on the same broker,
   * so change it to something unique to your group.
   */
  brokers: ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'],
  topicPrefix: 'hff-sal',
};

const TEXT = {
  gameName: () => CONFIG.gameName,
  orgShort: () => CONFIG.orgShort,
  orgLine: () => `${CONFIG.orgShort} at ${CONFIG.venue}`,
  orgFull: () => `${CONFIG.orgFull} · ${CONFIG.venue}`,
};

/** Fills every [data-brand="gameName|orgShort|orgLine|orgFull"] element and sets the page title. */
export function applyBranding(pageName) {
  document.querySelectorAll('[data-brand]').forEach((el) => {
    const f = TEXT[el.dataset.brand];
    if (f) el.textContent = f();
  });
  if (pageName) document.title = `${pageName} · ${CONFIG.gameName}`;
}
