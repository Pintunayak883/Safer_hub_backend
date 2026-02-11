const fs = require("fs");
const path = require("path");

// Simple synthetic generator for Jaipur area (approx bbox)
// Jaipur center approx: lat ~26.9124, lng ~75.7873

const CENTER = { lat: 26.9124, lng: 75.7873 };

function randRange(a, b) {
  return a + Math.random() * (b - a);
}

function jitter(lat, lng, meters) {
  // meters to degrees approx
  const deg = meters / 111320;
  return [
    lng + (Math.random() - 0.5) * deg * 2,
    lat + (Math.random() - 0.5) * deg * 2,
  ];
}

function pickLighting() {
  const r = Math.random();
  if (r < 0.4) return "normal";
  if (r < 0.75) return "dark";
  return "unknown";
}

function generate(n = 1000) {
  const items = [];
  for (let i = 0; i < n; i++) {
    // Bias: more points near center and along a rough E-W corridor
    const radial = Math.pow(Math.random(), 2);
    const angle = Math.random() * Math.PI * 2;
    const distMeters = radial * 8000; // up to ~8km
    const ddeg = distMeters / 111320;
    const lat = CENTER.lat + Math.cos(angle) * ddeg;
    const lng = CENTER.lng + Math.sin(angle) * ddeg;

    // small jitter to simulate on-road
    const [jlng, jlat] = jitter(lat, lng, 25);

    const lighting = Math.random() < 0.35 ? "dark" : "normal";
    const ts = new Date(
      Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 90)
    ).toISOString();

    items.push({
      lat: jlat,
      lng: jlng,
      type: "incident",
      title: "synthetic seed",
      description: "Synthetic report for Jaipur seeding",
      lightingFlag: lighting,
      timestamp: ts,
    });
  }
  return items;
}

function main() {
  const n = Number(process.argv[2] || 1000);
  const out = path.join(__dirname, "jaipur_seed.json");
  const data = generate(n);
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(`Wrote ${data.length} synthetic reports to ${out}`);
}

main();
