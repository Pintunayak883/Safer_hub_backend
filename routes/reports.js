const express = require("express");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const Report = require("../models/Report");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { latLngToTileId, tileIdToCentroid } = require("../utils/geo");
const { enforceKAnonymity, removeRawCoords } = require("../middleware/privacy");
const auth = require("../middleware/auth");
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/evidence/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname +
        "-" +
        uniqueSuffix +
        "." +
        file.originalname.split(".").pop()
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|pdf|doc|docx/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, videos, and documents are allowed."
        )
      );
    }
  },
});

// GET safest route between two points (simple MVP)
// GET /api/reports/safest-route?start=lng,lat&end=lng,lat&steps=20
router.get("/safest-route", async (req, res) => {
  try {
    const {
      start,
      end,
      steps = 20,
      days = process.env.AGG_WINDOW_DAYS || 30,
    } = req.query;
    if (!start || !end)
      return res
        .status(400)
        .json({ message: 'start and end query params required as "lng,lat"' });

    const parseCoord = (s) => s.split(",").map(Number);
    const [startLng, startLat] = parseCoord(start);
    const [endLng, endLat] = parseCoord(end);

    const stepsNum = Math.max(5, Math.min(200, Number(steps)));

    function sampleLine(lng1, lat1, lng2, lat2, n) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const lng = lng1 + (lng2 - lng1) * t;
        const lat = lat1 + (lat2 - lat1) * t;
        pts.push([lng, lat]);
      }
      return pts;
    }

    // generate three candidate routes: center, offset north, offset south
    const centerPts = sampleLine(startLng, startLat, endLng, endLat, stepsNum);

    // compute a small lat offset (~3 * tile size)
    const tileSize = Number(process.env.TILE_SIZE_M || 50);
    const metersPerDegree = 111320;
    const offsetDeg = (tileSize * 3) / metersPerDegree;

    const northPts = centerPts.map(([lng, lat]) => [lng, lat + offsetDeg]);
    const southPts = centerPts.map(([lng, lat]) => [lng, lat - offsetDeg]);

    const allPts = [...centerPts, ...northPts, ...southPts];

    // map points to tileIds
    const tileIds = Array.from(
      new Set(allPts.map(([lng, lat]) => latLngToTileId(lat, lng, tileSize)))
    );

    // aggregation window
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // aggregate counts for these tiles
    const agg = await Report.aggregate([
      {
        $match: {
          status: "submitted",
          createdAt: { $gte: startDate },
          tileId: { $in: tileIds },
        },
      },
      { $group: { _id: "$tileId", count: { $sum: 1 } } },
      { $project: { tileId: "$_id", count: 1, _id: 0 } },
    ]);

    const counts = {};
    agg.forEach((a) => (counts[a.tileId] = a.count));
    const maxCount = Math.max(1, ...Object.values(counts));
    const K_ANON = Number(process.env.K_ANON || 3);

    function scoreRoute(pts) {
      const tiles = pts.map(([lng, lat]) => latLngToTileId(lat, lng, tileSize));
      const uniqueTiles = Array.from(new Set(tiles));
      let sum = 0;
      let known = 0;
      uniqueTiles.forEach((tid) => {
        const c = counts[tid] || 0;
        if (c === 0) return; // treat unknown as neutral
        if (c < K_ANON) return; // skip masked tiles
        const normalized = Math.min(0.7, (c / maxCount) * 0.7);
        sum += normalized;
        known += 1;
      });
      const avg = known > 0 ? sum / known : 0; // lower is safer
      return { score: Number(avg.toFixed(4)), tilesEvaluated: known };
    }

    const centerScore = scoreRoute(centerPts);
    const northScore = scoreRoute(northPts);
    const southScore = scoreRoute(southPts);

    const routes = [
      { name: "center", geometry: centerPts, ...centerScore },
      { name: "north_offset", geometry: northPts, ...northScore },
      { name: "south_offset", geometry: southPts, ...southScore },
    ];

    routes.sort((a, b) => a.score - b.score); // ascending: lower score = safer

    res.json({ routes, best: routes[0] });
  } catch (error) {
    console.error("Safest route error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/reports/score-geometry
// Body: { geometry: [[lng,lat], ...], days?: number }
router.post("/score-geometry", async (req, res) => {
  try {
    const { geometry, days = process.env.AGG_WINDOW_DAYS || 30 } = req.body;
    if (!Array.isArray(geometry) || geometry.length < 2) {
      return res
        .status(400)
        .json({ message: "geometry must be array of [lng,lat] points" });
    }

    const tileSize = Number(process.env.TILE_SIZE_M || 50);

    // map points to tileIds
    const tileIds = Array.from(
      new Set(geometry.map(([lng, lat]) => latLngToTileId(lat, lng, tileSize)))
    );

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const agg = await Report.aggregate([
      {
        $match: {
          status: "submitted",
          createdAt: { $gte: startDate },
          tileId: { $in: tileIds },
        },
      },
      { $group: { _id: "$tileId", count: { $sum: 1 } } },
      { $project: { tileId: "$_id", count: 1, _id: 0 } },
    ]);

    const counts = {};
    agg.forEach((a) => (counts[a.tileId] = a.count));
    const maxCount = Math.max(1, ...Object.values(counts));
    const K_ANON = Number(process.env.K_ANON || 3);

    // score geometry (unique tiles)
    const tiles = tileIds.map((tid) => ({
      tileId: tid,
      count: counts[tid] || 0,
    }));
    let sum = 0;
    let known = 0;
    tiles.forEach((t) => {
      const c = t.count;
      if (c === 0) return; // unknown
      if (c < K_ANON) return; // masked
      const normalized = Math.min(0.7, (c / maxCount) * 0.7);
      sum += normalized;
      known += 1;
    });

    const avg = known > 0 ? sum / known : 0;

    res.json({ score: Number(avg.toFixed(4)), tilesEvaluated: known, tiles });
  } catch (error) {
    console.error("score-geometry error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/reports/heatmap?bbox=minLng,minLat,maxLng,maxLat&days=90&tileSizeMeters=50
router.get("/heatmap", async (req, res) => {
  try {
    const { bbox, days = process.env.AGG_WINDOW_DAYS || 90, tileSizeMeters } = req.query;
    if (!bbox) return res.status(400).json({ message: "bbox required as minLng,minLat,maxLng,maxLat" });

    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4) return res.status(400).json({ message: "bbox must be 4 numbers" });
    const [minLng, minLat, maxLng, maxLat] = parts;

    const tileSize = Number(tileSizeMeters || process.env.TILE_SIZE_M || 50);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Simple in-memory cache to reduce repeated aggregation for same params (TTL 60s)
    if (!global.__heatmap_cache) global.__heatmap_cache = new Map();
    const cacheKey = `${bbox}|${days}|${tileSize}`;
    const cached = global.__heatmap_cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60 * 1000) {
      return res.json(cached.value);
    }

    // Use geoWithin polygon for 2dsphere
    const polygon = {
      type: "Polygon",
      coordinates: [[
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat]
      ]] ,
    };

    // Aggregate counts per tile, broken down by type so we can show both "danger" and "safe" signals
    const agg = await Report.aggregate([
      {
        $match: {
          status: "submitted",
          createdAt: { $gte: startDate },
          location: { $geoWithin: { $geometry: polygon } },
        },
      },
      {
        $group: {
          _id: "$tileId",
          totalCount: { $sum: 1 },
          positiveCount: {
            $sum: {
              $cond: [{ $eq: ["$type", "positive_experience"] }, 1, 0],
            },
          },
          incidentCount: {
            $sum: {
              $cond: [
                { $in: ["$type", ["incident", "harassment", "safety_concern"]] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          tileId: "$_id",
          totalCount: 1,
          positiveCount: 1,
          incidentCount: 1,
          _id: 0,
        },
      },
    ]);

    const K_ANON = Number(process.env.K_ANON || 3);
    const maxIncident = agg.reduce((m, a) => Math.max(m, a.incidentCount || 0), 0) || 1;
    const maxPositive = agg.reduce((m, a) => Math.max(m, a.positiveCount || 0), 0) || 1;

    const items = agg
      .filter((a) => a.totalCount >= K_ANON)
      .map((a) => {
        const c = tileIdToCentroid(a.tileId);
        const dangerWeight = a.incidentCount ? Number((a.incidentCount / maxIncident).toFixed(4)) : 0;
        const safeWeight = a.positiveCount ? Number((a.positiveCount / maxPositive).toFixed(4)) : 0;
        return {
          tileId: a.tileId,
          centroid: { lat: c.lat, lng: c.lng },
          totalCount: a.totalCount,
          incidentCount: a.incidentCount || 0,
          positiveCount: a.positiveCount || 0,
          dangerWeight,
          safeWeight,
        };
      });

    const out = { items, meta: { bbox: [minLng, minLat, maxLng, maxLat], tileSizeMeters: tileSize, tilesReturned: items.length, kAnon: K_ANON } };
    global.__heatmap_cache.set(cacheKey, { ts: Date.now(), value: out });
    return res.json(out);
  } catch (error) {
    console.error("heatmap error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/reports/directions?start=lng,lat&end=lng,lat&days=30
// Calls Google Directions server-side (requires server env GOOGLE_MAPS_API_KEY)
router.get("/directions", async (req, res) => {
  try {
    const { start, end, days = process.env.AGG_WINDOW_DAYS || 30 } = req.query;
    if (!start || !end)
      return res
        .status(400)
        .json({ message: "start and end required as lng,lat" });

    const parseCoord = (s) => s.split(",").map(Number);
    const [startLng, startLat] = parseCoord(start);
    const [endLng, endLat] = parseCoord(end);

    const key =
      process.env.GOOGLE_MAPS_API_KEY || process.env.SERVER_GOOGLE_MAPS_KEY;
    if (!key)
      return res
        .status(500)
        .json({ message: "Server missing Google Maps API key" });

    // New Google Routes API call
    const routesUrl = `https://routes.googleapis.com/directions/v2:computeRoutes`;
    const routesPayload = {
      origin: {
        location: { latLng: { latitude: startLat, longitude: startLng } },
      },
      destination: {
        location: { latLng: { latitude: endLat, longitude: endLng } },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      computeAlternativeRoutes: true,
      extraComputations: ["ROUTE_STATS", "TRAFFIC_DATA"],
    };

    // Try Routes API (new). If it fails (not enabled for project), fallback to legacy Directions API
    let json = null;
    let usedRoutesApi = true;
    try {
      const resp = await fetch(routesUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description",
        },
        body: JSON.stringify(routesPayload),
      });
      json = await resp.json();
      if (json.error) throw new Error(JSON.stringify(json.error));
    } catch (routesErr) {
      // log and attempt legacy Directions API as fallback
      console.warn(
        "Routes API failed, falling back to legacy Directions API:",
        routesErr && routesErr.message ? routesErr.message : routesErr
      );
      usedRoutesApi = false;
      const legacyUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
        startLat + "," + startLng
      )}&destination=${encodeURIComponent(
        endLat + "," + endLng
      )}&alternatives=true&key=${key}`;
      const legacyResp = await fetch(legacyUrl);
      json = await legacyResp.json();
      // if legacy also failed, return error
      if (json.status !== "OK") {
        // If Google Directions failed (billing/permission), fall back to internal sampling so UI still works
        console.warn(
          "Legacy Directions failed, falling back to internal sampling. Google response:",
          json
        );

        // generate three candidate routes: center, offset north, offset south (sampled straight lines)
        const stepsNum = Math.max(
          5,
          Math.min(200, Number(req.query.steps || 40))
        );
        function sampleLine(lng1, lat1, lng2, lat2, n) {
          const pts = [];
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const lng = lng1 + (lng2 - lng1) * t;
            const lat = lat1 + (lat2 - lat1) * t;
            pts.push([lng, lat]);
          }
          return pts;
        }

        const centerPts = sampleLine(
          startLng,
          startLat,
          endLng,
          endLat,
          stepsNum
        );
        const tileSizeLocal = Number(process.env.TILE_SIZE_M || 50);
        const metersPerDegree = 111320;
        const offsetDeg = (tileSizeLocal * 3) / metersPerDegree;
        const northPts = centerPts.map(([lng, lat]) => [lng, lat + offsetDeg]);
        const southPts = centerPts.map(([lng, lat]) => [lng, lat - offsetDeg]);

        const allPts = [...centerPts, ...northPts, ...southPts];
        const tileIds = Array.from(
          new Set(
            allPts.map(([lng, lat]) => latLngToTileId(lat, lng, tileSizeLocal))
          )
        );

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - Number(days));

        const agg = await Report.aggregate([
          {
            $match: {
              status: "submitted",
              createdAt: { $gte: startDate },
              tileId: { $in: tileIds },
            },
          },
          { $group: { _id: "$tileId", count: { $sum: 1 } } },
          { $project: { tileId: "$_id", count: 1, _id: 0 } },
        ]);

        const counts = {};
        agg.forEach((a) => (counts[a.tileId] = a.count));
        const maxCount = Math.max(1, ...Object.values(counts));
        const K_ANON = Number(process.env.K_ANON || 3);

        function scoreRoute(pts) {
          const tiles = pts.map(([lng, lat]) =>
            latLngToTileId(lat, lng, tileSizeLocal)
          );
          const uniqueTiles = Array.from(new Set(tiles));
          let sum = 0;
          let known = 0;
          uniqueTiles.forEach((tid) => {
            const c = counts[tid] || 0;
            if (c === 0) return;
            if (c < K_ANON) return;
            const normalized = Math.min(0.7, (c / maxCount) * 0.7);
            sum += normalized;
            known += 1;
          });
          const avg = known > 0 ? sum / known : 0;
          return { score: Number(avg.toFixed(4)), tilesEvaluated: known };
        }

        const centerScore = scoreRoute(centerPts);
        const northScore = scoreRoute(northPts);
        const southScore = scoreRoute(southPts);

        const routes = [
          { name: "center", geometry: centerPts, ...centerScore },
          { name: "north_offset", geometry: northPts, ...northScore },
          { name: "south_offset", geometry: southPts, ...southScore },
        ];
        routes.sort((a, b) => a.score - b.score);
        return res.json({ routes, best: routes[0] });
      }
    }

    // We need a polyline decoder for the new API
    function decodePolyline(encoded) {
      if (!encoded) return [];
      let index = 0,
        lat = 0,
        lng = 0,
        shift = 0,
        result = 0;
      const coordinates = [];
      while (index < encoded.length) {
        let b,
          shift = 0,
          result = 0;
        do {
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const dlat = result & 1 ? ~(result >> 1) : result >> 1;
        lat += dlat;
        shift = 0;
        result = 0;
        do {
          b = encoded.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const dlng = result & 1 ? ~(result >> 1) : result >> 1;
        lng += dlng;
        coordinates.push([lng / 1e5, lat / 1e5]);
      }
      return coordinates;
    }

    // For scoring we reuse the aggregation approach in /score-geometry
    const tileSize = Number(process.env.TILE_SIZE_M || 50);
    const K_ANON = Number(process.env.K_ANON || 3);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Score each returned route
    const routesOut = [];
    const countsCache = {}; // optional cache of tile counts

    // gather all tileIds needed across routes to aggregate in one query
    const allTileIds = new Set();
    let decodedRoutes = [];
    if (usedRoutesApi) {
      decodedRoutes = (json.routes || []).map((r) => ({
        summary: r.description || "",
        points: decodePolyline(r.polyline.encodedPolyline),
      }));
    } else {
      // legacy Directions response: routes[].overview_polyline.points
      decodedRoutes = (json.routes || []).map((r) => ({
        summary: r.summary || "",
        points: decodePolyline(r.overview_polyline.points),
      }));
    }

    decodedRoutes.forEach((dr) => {
      dr.tileIds = Array.from(
        new Set(
          dr.points.map(([lng, lat]) => latLngToTileId(lat, lng, tileSize))
        )
      );
      dr.tileIds.forEach((t) => allTileIds.add(t));
    });

    const agg = await Report.aggregate([
      {
        $match: {
          status: "submitted",
          createdAt: { $gte: startDate },
          tileId: { $in: Array.from(allTileIds) },
        },
      },
      { $group: { _id: "$tileId", count: { $sum: 1 } } },
      { $project: { tileId: "$_id", count: 1, _id: 0 } },
    ]);
    agg.forEach((a) => (countsCache[a.tileId] = a.count));
    const maxCount = Math.max(1, ...Object.values(countsCache));

    // scoring helper
    function scoreTiles(tileIds) {
      let sum = 0,
        known = 0;
      tileIds.forEach((tid) => {
        const c = countsCache[tid] || 0;
        if (c === 0) return;
        if (c < K_ANON) return;
        const normalized = Math.min(0.7, (c / maxCount) * 0.7);
        sum += normalized;
        known += 1;
      });
      return {
        score: Number((known > 0 ? sum / known : 0).toFixed(4)),
        tilesEvaluated: known,
      };
    }

    for (const dr of decodedRoutes) {
      const s = scoreTiles(dr.tileIds);
      routesOut.push({
        name: dr.summary || "directions",
        geometry: dr.points,
        ...s,
      });
    }

    routesOut.sort((a, b) => a.score - b.score);
    res.json({
      routes: routesOut,
      best: routesOut[0] || null,
      raw: { directionsStatus: json.status },
    });
  } catch (error) {
    console.error("Directions scoring error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create a new report (allows anonymous submissions)
router.post(
  "/",
  require("../middleware/auth").optionalAuth,
  upload.array("evidence", 5),
  [
    body("type")
      .isIn([
        "incident",
        "harassment",
        "safety_concern",
        "positive_experience",
        "tip",
      ])
      .withMessage("Invalid report type"),
    body("title")
      .trim()
      .isLength({ min: 5, max: 100 })
      .withMessage("Title must be between 5 and 100 characters"),
    body("description")
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage("Description must be between 10 and 1000 characters"),
    body("coordinates")
      .isArray({ min: 2, max: 2 })
      .withMessage("Coordinates must be an array of 2 numbers"),
    body("severity")
      .optional()
      .isIn(["low", "medium", "high", "critical"])
      .withMessage("Invalid severity level"),
    body("isAnonymous")
      .optional()
      .isBoolean()
      .withMessage("Is anonymous must be boolean"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        type,
        title,
        description,
        coordinates,
        address,
        neighborhood,
        city,
        timestamp,
        severity = "medium",
        isAnonymous = false,
        tags = [],
        voiceTranscription,
      } = req.body;

      // Handle file uploads
      const evidence = req.files
        ? req.files.map((file) => ({
            type: file.mimetype.startsWith("image/")
              ? "photo"
              : file.mimetype.startsWith("video/")
              ? "video"
              : file.mimetype.startsWith("audio/")
              ? "audio"
              : "document",
            url: `/uploads/evidence/${file.filename}`,
            filename: file.originalname,
          }))
        : [];

      // Compute tile id (server-side rounding) for privacy
      const coords = coordinates.map(Number);
      const lng = coords[0];
      const lat = coords[1];
      const tileSize = Number(process.env.TILE_SIZE_M || 50);
      const tileId = latLngToTileId(lat, lng, tileSize);

      // Create anonymized reporter hash (rotateable) - don't store raw IP
      const anonSeed = (req.body.anonId || "") + (req.ip || "") + Date.now();
      const anonHash = crypto
        .createHash("sha256")
        .update(anonSeed)
        .digest("hex")
        .slice(0, 16);

      const report = new Report({
        user: req.user ? req.user.id : null,
        tileId,
        anonHash,
        type,
        title,
        description,
        location: {
          type: "Point",
          coordinates: [lng, lat],
          address,
          neighborhood,
          city,
        },
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        timeBucket: new Date(timestamp ? new Date(timestamp) : new Date())
          .toISOString()
          .slice(0, 13),
        severity,
        isAnonymous,
        tags,
        evidence,
        lightingFlag: ["dark", "normal", "unknown"].includes(
          req.body.lightingFlag
        )
          ? req.body.lightingFlag
          : "unknown",
        voiceTranscription: voiceTranscription
          ? JSON.parse(voiceTranscription)
          : null,
      });

      await report.save();

      // Analyze patterns
      report.analyzePatterns();

      // Find similar reports
      const similarReports = await report.findSimilarReports();
      report.similarReports = similarReports.map((similar) => ({
        reportId: similar._id,
        similarityScore: 0.8, // Simplified similarity score
      }));

      await report.save();

      // Emit minimal tile update to clients (no PII)
      try {
        const serverIo = req.app && req.app.get ? req.app.get("io") : null;
        if (serverIo && serverIo.emit) serverIo.emit("tile:update", { tileId });
      } catch (e) {
        // ignore socket errors
      }

      res.status(201).json({
        message: "Report created successfully",
        report: {
          id: report._id,
          tileId: report.tileId,
          createdAt: report.createdAt,
        },
      });
    } catch (error) {
      console.error("Create report error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// GET aggregated tiles (privacy-preserving)
// Example: GET /api/reports/tiles?bbox=&days=30
router.get("/tiles", async (req, res) => {
  try {
    const days = Number(req.query.days || process.env.AGG_WINDOW_DAYS || 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Aggregate counts per tileId for public/submitted reports
    const agg = await Report.aggregate([
      { $match: { status: "submitted", createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: "$tileId",
          count: { $sum: 1 },
          latest: { $max: "$createdAt" },
          lighting: { $push: "$lightingFlag" },
        },
      },
      {
        $project: { tileId: "$_id", count: 1, latest: 1, lighting: 1, _id: 0 },
      },
    ]);

    // compute normalized score and explanations
    const maxCount = agg.reduce((m, a) => Math.max(m, a.count), 0) || 1;
    const K_ANON = Number(process.env.K_ANON || 3);

    const tiles = agg.map((a) => {
      const normalized = Math.min(0.7, (a.count / maxCount) * 0.7);
      const latestHour = new Date(a.latest).getHours();
      const night = latestHour < 6 || latestHour > 20;
      const nightPenalty = night ? 0.2 : 0;
      const darkReported = (a.lighting || []).some((f) => f === "dark");
      const darkPenalty = darkReported ? 0.1 : 0;
      const score = Math.min(1, normalized + nightPenalty + darkPenalty);

      const reasons = [];
      if (a.count > 0) reasons.push("historical_reports");
      if (night) reasons.push("late_hour");
      if (darkReported) reasons.push("low_lighting");

      return { tileId: a.tileId, count: a.count, score, reasons };
    });

    const filtered = enforceKAnonymity(tiles, K_ANON);

    // Add centroid for visualization for non-masked tiles
    const final = filtered.map((t) => {
      if (t.masked) return t;
      const centroid = tileIdToCentroid(t.tileId);
      return { ...t, centroid };
    });

    res.json({ tiles: final });
  } catch (error) {
    console.error("Tiles aggregation error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user's reports
router.get("/my-reports", auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;
    const query = { user: req.user.id };

    if (type) query.type = type;
    if (status) query.status = status;

    const reports = await Report.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate("user", "name profile.avatar");

    const total = await Report.countDocuments(query);

    res.json({
      reports,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Get user reports error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get public reports
router.get("/public", async (req, res) => {
  try {
    const { page = 1, limit = 10, type, city, radius = 1000 } = req.query;
    const query = { isPublic: true, status: "submitted" };

    if (type) query.type = type;
    if (city) query["location.city"] = city;

    let reports;

    if (req.query.coordinates) {
      const coordinates = JSON.parse(req.query.coordinates);
      reports = await Report.find({
        ...query,
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates,
            },
            $maxDistance: radius,
          },
        },
      });
    } else {
      reports = await Report.find(query);
    }

    reports = reports
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate("user", "name profile.avatar");

    const total = await Report.countDocuments(query);

    res.json({
      reports,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Get public reports error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update report
router.put(
  "/:id",
  auth,
  [
    body("title")
      .optional()
      .trim()
      .isLength({ min: 5, max: 100 })
      .withMessage("Title must be between 5 and 100 characters"),
    body("description")
      .optional()
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage("Description must be between 10 and 1000 characters"),
    body("severity")
      .optional()
      .isIn(["low", "medium", "high", "critical"])
      .withMessage("Invalid severity level"),
    body("status")
      .optional()
      .isIn(["draft", "submitted", "under_review", "resolved", "archived"])
      .withMessage("Invalid status"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const report = await Report.findById(req.params.id);

      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      // Check if user owns the report
      if (report.user.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Not authorized to update this report" });
      }

      const updates = req.body;
      Object.assign(report, updates);

      await report.save();

      res.json({
        message: "Report updated successfully",
        report,
      });
    } catch (error) {
      console.error("Update report error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete report
router.delete("/:id", auth, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Check if user owns the report
    if (report.user.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to delete this report" });
    }

    await Report.findByIdAndDelete(req.params.id);

    res.json({ message: "Report deleted successfully" });
  } catch (error) {
    console.error("Delete report error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Add comment to report
router.post(
  "/:id/comments",
  auth,
  [
    body("text")
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Comment must be between 1 and 500 characters"),
    body("isAnonymous")
      .optional()
      .isBoolean()
      .withMessage("Is anonymous must be boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { text, isAnonymous = false } = req.body;
      const report = await Report.findById(req.params.id);

      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      const comment = {
        user: req.user.id,
        text,
        isAnonymous,
      };

      report.comments.push(comment);
      await report.save();

      res.json({
        message: "Comment added successfully",
        comment,
      });
    } catch (error) {
      console.error("Add comment error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Vote on report
router.post(
  "/:id/vote",
  auth,
  [
    body("vote")
      .isIn(["up", "down"])
      .withMessage("Vote must be either up or down"),
  ],
  async (req, res) => {
    try {
      const { vote } = req.body;
      const report = await Report.findById(req.params.id);

      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }

      if (vote === "up") {
        report.upvotes += 1;
      } else {
        report.downvotes += 1;
      }

      await report.save();

      res.json({
        message: "Vote recorded successfully",
        upvotes: report.upvotes,
        downvotes: report.downvotes,
      });
    } catch (error) {
      console.error("Vote on report error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get report statistics
router.get("/stats/overview", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await Report.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalReports: { $sum: 1 },
          totalViews: { $sum: "$views" },
          totalUpvotes: { $sum: "$upvotes" },
          averageSafetyScore: { $avg: "$safetyScore" },
          reportsByType: {
            $push: {
              type: "$type",
              severity: "$severity",
            },
          },
        },
      },
    ]);

    res.json(
      stats[0] || {
        totalReports: 0,
        totalViews: 0,
        totalUpvotes: 0,
        averageSafetyScore: 0,
        reportsByType: [],
      }
    );
  } catch (error) {
    console.error("Get report stats error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get safety heatmap data
router.get("/heatmap/data", async (req, res) => {
  try {
    const { city, type, days = 30 } = req.query;
    const query = { isPublic: true, status: "submitted" };

    if (city) query["location.city"] = city;
    if (type) query.type = type;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    query.createdAt = { $gte: startDate };

    const heatmapData = await Report.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            lat: { $arrayElemAt: ["$location.coordinates", 1] },
            lng: { $arrayElemAt: ["$location.coordinates", 0] },
          },
          count: { $sum: 1 },
          averageSeverity: {
            $avg: {
              $cond: [
                { $eq: ["$severity", "critical"] },
                4,
                {
                  $cond: [
                    { $eq: ["$severity", "high"] },
                    3,
                    { $cond: [{ $eq: ["$severity", "medium"] }, 2, 1] },
                  ],
                },
              ],
            },
          },
          types: { $addToSet: "$type" },
        },
      }, // ✅ ye sahi hai
      {
        $project: {
          lat: "$_id.lat",
          lng: "$_id.lng",
          count: 1,
          averageSeverity: 1,
          types: 1,
          _id: 0,
        },
      },
    ]);

    res.json(heatmapData);
  } catch (error) {
    console.error("Get heatmap data error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get report by ID
router.get("/:id", async (req, res) => {
  try {
    // validate id is a valid ObjectId first — guards against named routes accidentally matching this param
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ message: "Report not found" });
    }

    const report = await Report.findById(req.params.id)
      .populate("user", "name profile.avatar")
      .populate("comments.user", "name profile.avatar");

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Increment view count
    report.views += 1;
    await report.save();

    res.json(report);
  } catch (error) {
    console.error("Get report error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
