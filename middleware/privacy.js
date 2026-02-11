const K_ANON = Number(process.env.K_ANON || 3);

function enforceKAnonymity(tiles, k = K_ANON) {
  // tiles: [{ tileId, count, ... }]
  return tiles.map((t) => {
    if ((t.count || 0) < k) {
      return { tileId: t.tileId, masked: true };
    }
    return t;
  });
}

function removeRawCoords(obj) {
  if (Array.isArray(obj)) return obj.map(removeRawCoords);
  if (obj && typeof obj === "object") {
    const copy = { ...obj };
    delete copy.location;
    delete copy.coordinates;
    return copy;
  }
  return obj;
}

module.exports = { enforceKAnonymity, removeRawCoords };
