const subs = new Map();

export function subscribe(channelIds, socket) {
  for (const id of channelIds) {
    if (!subs.has(id)) subs.set(id, new Set());
    subs.get(id).add(socket);
  }
  socket.on('close', () => {
    for (const id of channelIds) subs.get(id)?.delete(socket);
  });
}

export function broadcast(channelId, payload) {
  const set = subs.get(channelId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const s of set) { try { s.send(data); } catch {} }
}