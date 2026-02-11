const mongoose = require("mongoose");
require("dotenv").config();
const path = require("path");

const Report = require(path.join(__dirname, "..", "models", "Report"));
const { latLngToTileId } = require(path.join(__dirname, "..", "utils", "geo"));

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/safeherhub";

// A few simple route polylines (arrays of [lng,lat]) across Jaipur for seeding
const ROUTES = [
  {
    name: "Route_A_MI_to_Junction",
    points: [
      [75.796, 26.919], // MI Road
      [75.7935, 26.9185],
      [75.791, 26.918],
      [75.789, 26.9175],
      [75.7878, 26.9196], // Jaipur Junction
    ],
    dangerPattern: [false, true, true, false], // per segment
  },
  {
    name: "Route_B_Tonk_to_Bapu",
    points: [
      [75.809, 26.9128], // Tonk Phatak
      [75.805, 26.914],
      [75.802, 26.916],
      [75.826, 26.9239], // Bapu Bazaar
    ],
    dangerPattern: [true, true, false],
  },
  {
    name: "Route_C_Rambagh_to_CScheme",
    points: [
      [75.7877, 26.905], // Rambagh Palace
      [75.792, 26.908],
      [75.799, 26.912],
      [75.806, 26.9193], // C Scheme
    ],
    dangerPattern: [false, false, true],
  },
];

// helper: interpolate between two coords
function lerp(a, b, t) {
  return a + (b - a) * t;
}

async function main() {
  await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB for route seeding");

  const reports = [];
  const perRoute = Math.floor(1000 / ROUTES.length);
  const now = new Date();

  for (const route of ROUTES) {
    // Break route into segments and generate points along segments
    const segCount = route.points.length - 1;
    const reportsPerRoute = perRoute;
    for (let i = 0; i < reportsPerRoute; i++) {
      // choose a segment weighted by segment length
      const segIndex = Math.floor(Math.random() * segCount);
      const [lngA, latA] = route.points[segIndex];
      const [lngB, latB] = route.points[segIndex + 1];

      const t = Math.random();
      const lng = lerp(lngA, lngB, t);
      const lat = lerp(latA, latB, t);

      // Determine if this synthetic report is a danger one based on dangerPattern
      const danger = route.dangerPattern[segIndex] || false;

      // timestamp: spread over last 60 days, danger ones biased to night
      const ts = new Date(
        now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 60)
      );
      if (danger) {
        ts.setHours(22 + Math.floor(Math.random() * 3));
      } else {
        ts.setHours(9 + Math.floor(Math.random() * 8));
      }
      ts.setMinutes(Math.floor(Math.random() * 60));

      const tileId = latLngToTileId(
        lat,
        lng,
        Number(process.env.TILE_SIZE_M || 50)
      );

      // severity distribution
      const severity = danger
        ? Math.random() < 0.6
          ? "high"
          : "medium"
        : Math.random() < 0.2
        ? "medium"
        : "low";
      const lightingFlag = danger ? "dark" : "normal";

      reports.push({
        tileId,
        type: danger ? "incident" : "tip",
        title: `${route.name} synthetic ${danger ? "incident" : "note"}`,
        description: `${danger ? "Dangerous" : "Safe"} segment along ${
          route.name
        }`,
        location: {
          type: "Point",
          coordinates: [lng, lat],
          address: route.name,
          city: "Jaipur",
        },
        timestamp: ts,
        severity,
        lightingFlag,
        isAnonymous: true,
        status: "submitted",
        isPublic: true,
        anonHash: "seed-" + Math.random().toString(36).slice(2, 10),
      });
    }
  }

  // If we have fewer than 1000 due to rounding, add random extras along first route
  while (reports.length < 1000) {
    const route = ROUTES[0];
    const segIndex = Math.floor(Math.random() * (route.points.length - 1));
    const [lngA, latA] = route.points[segIndex];
    const [lngB, latB] = route.points[segIndex + 1];
    const t = Math.random();
    const lng = lerp(lngA, lngB, t);
    const lat = lerp(latA, latB, t);
    const ts = new Date(
      now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 60)
    );
    ts.setHours(22 + Math.floor(Math.random() * 3));
    ts.setMinutes(Math.floor(Math.random() * 60));
    const tileId = latLngToTileId(
      lat,
      lng,
      Number(process.env.TILE_SIZE_M || 50)
    );
    reports.push({
      tileId,
      type: "incident",
      title: `extra synthetic incident`,
      description: `Extra seeded incident`,
      location: {
        type: "Point",
        coordinates: [lng, lat],
        address: route.name,
        city: "Jaipur",
      },
      timestamp: ts,
      severity: "high",
      lightingFlag: "dark",
      isAnonymous: true,
      status: "submitted",
      isPublic: true,
      anonHash: "seed-" + Math.random().toString(36).slice(2, 10),
    });
  }

  console.log(`Inserting ${reports.length} synthetic route reports...`);
  // insert in batches to avoid large single insert
  const BATCH = 200;
  for (let i = 0; i < reports.length; i += BATCH) {
    const batch = reports.slice(i, i + BATCH);
    await Report.insertMany(batch);
    console.log(
      `Inserted ${Math.min(i + BATCH, reports.length)} / ${reports.length}`
    );
  }

  console.log("Route seeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
