const mongoose = require('mongoose');
const Report = require('../models/Report');
const { latLngToTileId } = require('../utils/geo');

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/saferhub';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB for heatmap demo seeding');

  // Clear a small subset for demo (optional)
  // await Report.deleteMany({ title: /Heatmap demo/ });

  const now = new Date();
  const cityCenter = { lat: 26.9124, lng: 75.7873 };

  // Dangerous hotspots (more reports)
  const dangerZones = [
    { lat: 26.9196, lng: 75.7878 }, // near Jaipur Junction
    { lat: 26.9235, lng: 75.8215 }, // Badi Chaupar area
    { lat: 26.9112, lng: 75.7436 }, // Vaishali Nagar
  ];

  // Safer zones (fewer reports)
  const safeZones = [
    { lat: 26.9050, lng: 75.7877 }, // Rambagh Palace
    { lat: 26.8394, lng: 75.7879 }, // Sanganer outskirts
  ];

  const docs = [];

  // Insert many reports around danger zones
  for (const z of dangerZones) {
    for (let i = 0; i < 20; i++) {
      const jitterLat = z.lat + (Math.random() - 0.5) * 0.002;
      const jitterLng = z.lng + (Math.random() - 0.5) * 0.002;
      const tileId = latLngToTileId(jitterLat, jitterLng, Number(process.env.TILE_SIZE_M || 50));
      docs.push({
        type: 'incident',
        title: 'Heatmap demo - dangerous',
        description: 'Synthetic report for heatmap demo (dangerous area)',
        location: { type: 'Point', coordinates: [jitterLng, jitterLat], city: 'Jaipur' },
        timestamp: new Date(now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24)),
        severity: Math.random() > 0.6 ? 'high' : 'medium',
        status: 'submitted',
        isPublic: true,
        verified: Math.random() > 0.7,
        tileId,
        anonHash: 'demo-' + Math.random().toString(36).slice(2, 10),
      });
    }
  }

  // Insert fewer reports around safe zones
  for (const z of safeZones) {
    for (let i = 0; i < 4; i++) {
      const jitterLat = z.lat + (Math.random() - 0.5) * 0.001;
      const jitterLng = z.lng + (Math.random() - 0.5) * 0.001;
      const tileId = latLngToTileId(jitterLat, jitterLng, Number(process.env.TILE_SIZE_M || 50));
      docs.push({
        type: 'positive_experience',
        title: 'Heatmap demo - safe',
        description: 'Synthetic report for heatmap demo (safer area)',
        location: { type: 'Point', coordinates: [jitterLng, jitterLat], city: 'Jaipur' },
        timestamp: new Date(now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24)),
        severity: 'low',
        status: 'submitted',
        isPublic: true,
        verified: false,
        tileId,
        anonHash: 'demo-' + Math.random().toString(36).slice(2, 10),
      });
    }
  }

  // Add some random background noise
  for (let i = 0; i < 30; i++) {
    const jitterLat = cityCenter.lat + (Math.random() - 0.5) * 0.08;
    const jitterLng = cityCenter.lng + (Math.random() - 0.5) * 0.08;
    const tileId = latLngToTileId(jitterLat, jitterLng, Number(process.env.TILE_SIZE_M || 50));
    docs.push({
      type: Math.random() > 0.7 ? 'harassment' : 'safety_concern',
      title: 'Heatmap demo - background',
      description: 'Synthetic background report',
      location: { type: 'Point', coordinates: [jitterLng, jitterLat], city: 'Jaipur' },
      timestamp: new Date(now.getTime() - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30)),
      severity: Math.random() > 0.8 ? 'high' : 'medium',
      status: 'submitted',
      isPublic: true,
      verified: false,
      tileId,
      anonHash: 'demo-' + Math.random().toString(36).slice(2, 10),
    });
  }

  console.log(`Inserting ${docs.length} synthetic heatmap demo reports...`);
  await Report.insertMany(docs);
  console.log('Seeding complete.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Heatmap seeding failed:', err);
  process.exit(1);
});
