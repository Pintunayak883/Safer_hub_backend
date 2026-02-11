const geolib = require("geolib");

// Convert lat/lng to a privacy-preserving tile id by snapping to a regular grid
// tileSizeMeters: size of square tile in meters (e.g., 50 or 100)
function latLngToTileId(lat, lng, tileSizeMeters = 50) {
  // Use a simple equirectangular projection approximation: convert meters to degrees
  const metersPerDegree = 111320; // ~ meters per degree latitude

  const deg = tileSizeMeters / metersPerDegree;

  const latTile = Math.floor(lat / deg) * deg;
  const lngTile = Math.floor(lng / deg) * deg;

  // Use fixed precision to keep ids compact
  return `${latTile.toFixed(6)}_${lngTile.toFixed(6)}`;
}

function tileIdToCentroid(tileId) {
  const [latStr, lngStr] = tileId.split("_");
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  // centroid is the tile origin in this scheme; it's fine for visualization
  return { lat, lng };
}

module.exports = { latLngToTileId, tileIdToCentroid };
