const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  PulseCheck,
  SafetyStreak,
  CommunityPulse,
  PulseSchedule,
} = require("../models/Pulse");
const User = require("../models/User");
const auth = require("../middleware/auth");
const router = express.Router();

// Create a pulse check
router.post(
  "/",
  auth,
  [
    body("question")
      .trim()
      .isLength({ min: 5, max: 200 })
      .withMessage("Question must be between 5 and 200 characters"),
    body("type")
      .isIn(["safety", "mood", "location", "wellbeing", "custom"])
      .withMessage("Invalid pulse type"),
    body("response.value")
      .isIn([
        "safe",
        "unsafe",
        "neutral",
        "happy",
        "sad",
        "anxious",
        "confident",
        "scared",
      ])
      .withMessage("Invalid response value"),
    body("response.text")
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage("Response text must be less than 500 characters"),
    body("response.confidence")
      .optional()
      .isInt({ min: 1, max: 10 })
      .withMessage("Confidence must be between 1 and 10"),
    body("coordinates")
      .optional()
      .isArray({ min: 2, max: 2 })
      .withMessage("Coordinates must be an array of 2 numbers"),
    body("isAnonymous")
      .optional()
      .isBoolean()
      .withMessage("Is anonymous must be boolean"),
    body("isPublic")
      .optional()
      .isBoolean()
      .withMessage("Is public must be boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        question,
        type,
        response,
        coordinates,
        address,
        accuracy,
        context,
        isAnonymous = false,
        isPublic = false,
        tags = [],
        metadata,
      } = req.body;

      const pulseCheck = new PulseCheck({
        user: req.user.id,
        question,
        type,
        response,
        location: coordinates
          ? {
              type: "Point",
              coordinates,
              address,
              accuracy,
            }
          : undefined,
        context,
        isAnonymous,
        isPublic,
        tags,
        metadata,
      });

      await pulseCheck.save();

      // Update safety streak
      let safetyStreak = await SafetyStreak.findOne({ user: req.user.id });
      if (!safetyStreak) {
        safetyStreak = new SafetyStreak({ user: req.user.id });
      }

      const isPositive = ["safe", "happy", "confident"].includes(
        response.value
      );
      await safetyStreak.updateStreak(isPositive);

      // Check for badge eligibility
      const newBadges = safetyStreak.checkBadgeEligibility();
      if (newBadges.length > 0) {
        await safetyStreak.save();
      }

      // Update community pulse if public
      if (isPublic && coordinates) {
        await updateCommunityPulse(coordinates, response.value, address);
      }

      res.status(201).json({
        message: "Pulse check completed successfully",
        pulseCheck,
        safetyStreak: {
          currentStreak: safetyStreak.currentStreak,
          longestStreak: safetyStreak.longestStreak,
          newBadges: newBadges,
        },
      });
    } catch (error) {
      console.error("Create pulse check error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get user's pulse checks
router.get("/my-pulses", auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, type, isPublic } = req.query;
    const query = { user: req.user.id };

    if (type) query.type = type;
    if (isPublic !== undefined) query.isPublic = isPublic === "true";

    const pulseChecks = await PulseCheck.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await PulseCheck.countDocuments(query);

    res.json({
      pulseChecks,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Get user pulse checks error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get public pulse checks
router.get("/public", async (req, res) => {
  try {
    const { page = 1, limit = 10, type, city, radius = 1000 } = req.query;
    const query = { isPublic: true };

    if (type) query.type = type;
    if (city) query["location.address"] = { $regex: city, $options: "i" };

    let pulseChecks;

    if (req.query.coordinates) {
      const coordinates = JSON.parse(req.query.coordinates);
      pulseChecks = await PulseCheck.find({
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
      pulseChecks = await PulseCheck.find(query);
    }

    pulseChecks = pulseChecks
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice((page - 1) * limit, page * limit);

    const total = await PulseCheck.countDocuments(query);

    res.json({
      pulseChecks,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Get public pulse checks error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get safety streak
router.get("/safety-streak", auth, async (req, res) => {
  try {
    let safetyStreak = await SafetyStreak.findOne({ user: req.user.id });

    if (!safetyStreak) {
      safetyStreak = new SafetyStreak({ user: req.user.id });
      await safetyStreak.save();
    }

    res.json(safetyStreak);
  } catch (error) {
    console.error("Get safety streak error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get community pulse
router.get("/community-pulse", async (req, res) => {
  try {
    const { city, radius = 1000, days = 7 } = req.query;

    let query = {};
    if (city) query["location.address"] = { $regex: city, $options: "i" };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    query.createdAt = { $gte: startDate };

    let communityPulse = await CommunityPulse.findOne({
      ...query,
      isActive: true,
    });

    if (!communityPulse) {
      // Create new community pulse
      communityPulse = new CommunityPulse({
        location: req.query.coordinates
          ? {
              type: "Point",
              coordinates: JSON.parse(req.query.coordinates),
              radius: radius,
            }
          : undefined,
        timeRange: {
          start: startDate,
          end: new Date(),
        },
      });
    }

    // Calculate community pulse
    const pulseData = await PulseCheck.aggregate([
      { $match: { isPublic: true, ...query } },
      {
        $group: {
          _id: null,
          totalResponses: { $sum: 1 },
          safeCount: {
            $sum: { $cond: [{ $eq: ["$response.value", "safe"] }, 1, 0] },
          },
          unsafeCount: {
            $sum: { $cond: [{ $eq: ["$response.value", "unsafe"] }, 1, 0] },
          },
          neutralCount: {
            $sum: { $cond: [{ $eq: ["$response.value", "neutral"] }, 1, 0] },
          },
        },
      },
    ]);

    if (pulseData.length > 0) {
      const data = pulseData[0];
      communityPulse.totalResponses = data.totalResponses;
      communityPulse.responseDistribution = {
        safe: data.safeCount,
        unsafe: data.unsafeCount,
        neutral: data.neutralCount,
      };

      communityPulse.calculateCommunityPulse();
      communityPulse.generateInsights();
      await communityPulse.save();
    }

    res.json(communityPulse);
  } catch (error) {
    console.error("Get community pulse error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create pulse schedule
router.post(
  "/schedule",
  auth,
  [
    body("frequency")
      .isIn(["random", "hourly", "daily", "weekly", "custom"])
      .withMessage("Invalid frequency"),
    body("locationBased.isEnabled")
      .optional()
      .isBoolean()
      .withMessage("Location based must be boolean"),
    body("timeBased.isEnabled")
      .optional()
      .isBoolean()
      .withMessage("Time based must be boolean"),
    body("questionBank")
      .optional()
      .isArray()
      .withMessage("Question bank must be an array"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        frequency,
        customSchedule,
        locationBased,
        timeBased,
        questionBank = [],
      } = req.body;

      let pulseSchedule = await PulseSchedule.findOne({
        user: req.user.id,
        isActive: true,
      });

      if (pulseSchedule) {
        // Update existing schedule
        Object.assign(pulseSchedule, {
          frequency,
          customSchedule,
          locationBased,
          timeBased,
          questionBank,
        });
      } else {
        // Create new schedule
        pulseSchedule = new PulseSchedule({
          user: req.user.id,
          frequency,
          customSchedule,
          locationBased,
          timeBased,
          questionBank,
        });
      }

      // Schedule next pulse check
      const nextScheduled = pulseSchedule.scheduleNext();
      pulseSchedule.nextScheduled = nextScheduled;

      await pulseSchedule.save();

      res.json({
        message: "Pulse schedule created successfully",
        pulseSchedule,
        nextScheduled,
      });
    } catch (error) {
      console.error("Create pulse schedule error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get pulse schedule
router.get("/schedule", auth, async (req, res) => {
  try {
    const pulseSchedule = await PulseSchedule.findOne({
      user: req.user.id,
      isActive: true,
    });

    if (!pulseSchedule) {
      return res.json({ message: "No pulse schedule found" });
    }

    res.json(pulseSchedule);
  } catch (error) {
    console.error("Get pulse schedule error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update pulse schedule
router.put(
  "/schedule",
  auth,
  [
    body("frequency")
      .optional()
      .isIn(["random", "hourly", "daily", "weekly", "custom"])
      .withMessage("Invalid frequency"),
    body("isActive")
      .optional()
      .isBoolean()
      .withMessage("Is active must be boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const updates = req.body;
      const pulseSchedule = await PulseSchedule.findOne({
        user: req.user.id,
        isActive: true,
      });

      if (!pulseSchedule) {
        return res.status(404).json({ message: "Pulse schedule not found" });
      }

      Object.assign(pulseSchedule, updates);

      if (updates.frequency) {
        const nextScheduled = pulseSchedule.scheduleNext();
        pulseSchedule.nextScheduled = nextScheduled;
      }

      await pulseSchedule.save();

      res.json({
        message: "Pulse schedule updated successfully",
        pulseSchedule,
      });
    } catch (error) {
      console.error("Update pulse schedule error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get pulse statistics
router.get("/stats/overview", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const stats = await PulseCheck.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalPulses: { $sum: 1 },
          averageSafetyScore: { $avg: "$safetyScore" },
          pulsesByType: {
            $push: {
              type: "$type",
              response: "$response.value",
            },
          },
        },
      },
    ]);

    const safetyStreak = await SafetyStreak.findOne({ user: userId });

    res.json({
      pulses: stats[0] || {
        totalPulses: 0,
        averageSafetyScore: 0,
        pulsesByType: [],
      },
      safetyStreak: safetyStreak
        ? {
            currentStreak: safetyStreak.currentStreak,
            longestStreak: safetyStreak.longestStreak,
            totalCheckIns: safetyStreak.totalCheckIns,
            badges: safetyStreak.badges,
          }
        : null,
    });
  } catch (error) {
    console.error("Get pulse stats error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get safety heatmap data
router.get("/heatmap/data", async (req, res) => {
  try {
    const { city, type, days = 30 } = req.query;
    const query = { isPublic: true };

    if (city) query["location.address"] = { $regex: city, $options: "i" };
    if (type) query.type = type;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    query.createdAt = { $gte: startDate };

    const heatmapData = await PulseCheck.aggregate([
      { $match: query },
      {
        $group: {
          _id: {
            lat: { $arrayElemAt: ["$location.coordinates", 1] },
            lng: { $arrayElemAt: ["$location.coordinates", 0] },
          },
          count: { $sum: 1 },
          averageSafetyScore: { $avg: "$safetyScore" },
          responseDistribution: {
            $push: "$response.value",
          },
        },
      },
      {
        $project: {
          lat: "$_id.lat",
          lng: "$_id.lng",
          count: 1,
          averageSafetyScore: 1,
          responseDistribution: 1,
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

// Helper function to update community pulse
async function updateCommunityPulse(coordinates, responseValue, address) {
  try {
    let communityPulse = await CommunityPulse.findOne({
      "location.coordinates": coordinates,
      isActive: true,
    });

    if (!communityPulse) {
      communityPulse = new CommunityPulse({
        location: {
          type: "Point",
          coordinates,
          radius: 1000,
        },
        timeRange: {
          start: new Date(),
          end: new Date(),
        },
      });
    }

    communityPulse.totalResponses += 1;

    if (responseValue === "safe") {
      communityPulse.responseDistribution.safe += 1;
    } else if (responseValue === "unsafe") {
      communityPulse.responseDistribution.unsafe += 1;
    } else {
      communityPulse.responseDistribution.neutral += 1;
    }

    communityPulse.calculateCommunityPulse();
    await communityPulse.save();
  } catch (error) {
    console.error("Update community pulse error:", error);
  }
}

module.exports = router;
