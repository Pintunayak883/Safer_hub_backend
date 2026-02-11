const mongoose = require("mongoose");
require("dotenv").config();
const Report = require("../models/Report");
const { latLngToTileId } = require("../utils/geo");

async function seed() {
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/safeherhub"
  );
  console.log("Connected to DB");

  // simple demo points (lat, lng)
  const demoPoints = [
    { lat: 28.6139, lng: 77.209, count: 6 }, // sample high
    { lat: 28.6145, lng: 77.21, count: 3 },
    { lat: 28.615, lng: 77.211, count: 1 },
  ];

  for (const p of demoPoints) {
    const tileId = latLngToTileId(
      p.lat,
      p.lng,
      Number(process.env.TILE_SIZE_M || 50)
    );
    for (let i = 0; i < p.count; i++) {
      const r = new Report({
        user: mongoose.Types.ObjectId(),
        tileId,
        anonHash: "seed",
        type: "incident",
        title: "Seeded demo report",
        description: "This is a seeded demo report",
        location: { type: "Point", coordinates: [p.lng, p.lat] },
        timestamp: new Date(
          Date.now() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 10)
        ),
        severity: "medium",
        isAnonymous: true,
        status: "submitted",
      });
      await r.save();
    }
  }

  console.log("Seeding complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
