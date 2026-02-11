const mongoose = require("mongoose");
require("dotenv").config();
const path = require("path");

const Report = require(path.join(__dirname, "..", "models", "Report"));
const { latLngToTileId } = require(path.join(__dirname, "..", "utils", "geo"));

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/safeherhub";

const POIS = [
  { name: "Jaipur Junction", lat: 26.9196, lng: 75.7878, danger: true },
  { name: "MI Road", lat: 26.919, lng: 75.796, danger: true },
  { name: "Badi Chaupar", lat: 26.9235, lng: 75.8215, danger: true },
  { name: "Sanganer", lat: 26.8394, lng: 75.7879, danger: true },
  { name: "C Scheme", lat: 26.9193, lng: 75.806, danger: false },
  { name: "Rambagh Palace", lat: 26.905, lng: 75.7877, danger: false },
  { name: "Vaishali Nagar", lat: 26.9112, lng: 75.7436, danger: false },
  { name: "Bapu Bazaar", lat: 26.9239, lng: 75.826, danger: true },
  { name: "Tonk Phatak", lat: 26.9128, lng: 75.809, danger: true },
  { name: "Station Road", lat: 26.9179, lng: 75.7927, danger: true },
];

async function main() {
  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB for seeding");

  const reports = [];
  const now = new Date();

  for (const poi of POIS) {
    // create more reports for danger spots at night (past dates)
    const dangerCount = poi.danger ? 40 : 8;
    const safeCount = poi.danger ? 6 : 20;

    // danger reports (night)
    for (let i = 0; i < dangerCount; i++) {
      const ts = new Date(
        now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 60)
      );
      // force night hours for danger reports
      ts.setHours(22 + Math.floor(Math.random() * 2));
      ts.setMinutes(Math.floor(Math.random() * 60));

      const tileId = latLngToTileId(
        poi.lat,
        poi.lng,
        Number(process.env.TILE_SIZE_M || 50)
      );

      reports.push({
        tileId,
        type: "incident",
        title: `${poi.name} - reported incident`,
        description: `Synthetic ${
          poi.danger ? "danger" : "minor"
        } incident at ${poi.name}`,
        location: {
          type: "Point",
          coordinates: [poi.lng, poi.lat],
          address: poi.name,
          city: "Jaipur",
        },
        timestamp: ts,
        severity: poi.danger ? "high" : "low",
        lightingFlag: poi.danger ? "dark" : "normal",
        isAnonymous: true,
        status: "submitted",
        isPublic: true,
        anonHash: "seed-" + Math.random().toString(36).slice(2, 10),
      });
    }

    // safe reports (day)
    for (let i = 0; i < safeCount; i++) {
      const ts = new Date(
        now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 60)
      );
      // daytime hours
      ts.setHours(10 + Math.floor(Math.random() * 6));
      ts.setMinutes(Math.floor(Math.random() * 60));

      const tileId = latLngToTileId(
        poi.lat,
        poi.lng,
        Number(process.env.TILE_SIZE_M || 50)
      );

      reports.push({
        tileId,
        type: "tip",
        title: `${poi.name} - daytime activity`,
        description: `Synthetic safe activity at ${poi.name}`,
        location: {
          type: "Point",
          coordinates: [poi.lng, poi.lat],
          address: poi.name,
          city: "Jaipur",
        },
        timestamp: ts,
        severity: "low",
        lightingFlag: "normal",
        isAnonymous: true,
        status: "submitted",
        isPublic: true,
        anonHash: "seed-" + Math.random().toString(36).slice(2, 10),
      });
    }
  }

  console.log(`Inserting ${reports.length} synthetic reports...`);
  // Use insertMany for speed
  await Report.insertMany(reports);
  console.log("Seeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
