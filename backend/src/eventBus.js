// ---------------------------------------------------------------------------
//  Tiny in-process event bus for SSE fan-out. Replace with Redis pub/sub if
//  the API ever runs as more than one node.
//
//  Publishers (route handlers) call publish('comm', {action: 'created', id}).
//  Subscribers (SSE connections) call subscribe(handler) and receive every
//  emitted event until they unsubscribe.
//
//  Keep payloads small — the SSE client uses them as cache-invalidation
//  signals, not as data carriers.
// ---------------------------------------------------------------------------
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // SSE clients = listeners; we cap at the OS file-descriptor limit.

function publish(kind, payload = {}) {
  const event = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    kind,
    payload,
    at: new Date().toISOString(),
  };
  emitter.emit('event', event);
  return event;
}

function subscribe(handler) {
  emitter.on('event', handler);
  return () => emitter.off('event', handler);
}

module.exports = { publish, subscribe };
