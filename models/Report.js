const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Tile id (privacy-preserving grid id generated from location)
    tileId: {
      type: String,
      index: true,
    },
    // Optional lightweight flags for quick scoring
    timeBucket: { type: String }, // e.g. '2025-10-09T22' or hour bucket
    lightingFlag: {
      type: String,
      enum: ["dark", "normal", "unknown"],
      default: "unknown",
    },
    // Short anonymized reporter hash (rotateable) for reputation without PII
    anonHash: { type: String, index: true },
    // Moderation / verification used to increase weight
    verified: { type: Boolean, default: false },
    type: {
      type: String,
      enum: [
        "incident",
        "harassment",
        "safety_concern",
        "positive_experience",
        "tip",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
      address: String,
      neighborhood: String,
      city: String,
    },
    timestamp: {
      type: Date,
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    isAnonymous: {
      type: Boolean,
      default: false,
    },
    evidence: [
      {
        type: {
          type: String,
          enum: ["photo", "video", "audio", "document"],
        },
        url: String,
        filename: String,
        description: String,
      },
    ],
    voiceTranscription: {
      text: String,
      confidence: Number,
      language: String,
    },
    tags: [String],
    status: {
      type: String,
      enum: ["draft", "submitted", "under_review", "resolved", "archived"],
      default: "draft",
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    comments: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: String,
        isAnonymous: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    similarReports: [
      {
        reportId: { type: mongoose.Schema.Types.ObjectId, ref: "Report" },
        similarityScore: Number,
      },
    ],
    patternAnalysis: {
      timeOfDay: String,
      dayOfWeek: String,
      locationType: String,
      riskLevel: String,
      suggestions: [String],
    },
    moderation: {
      isModerated: { type: Boolean, default: false },
      moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      moderatedAt: Date,
      moderationNotes: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for geospatial queries
reportSchema.index({ location: "2dsphere" });
reportSchema.index({ timestamp: -1 });
reportSchema.index({ type: 1, severity: 1 });
reportSchema.index({ user: 1, status: 1 });
// Index to help tile aggregations and time-bounded queries
reportSchema.index({ tileId: 1, createdAt: -1 });

// Virtual for calculating safety score
reportSchema.virtual("safetyScore").get(function () {
  const baseScore = 100;
  const severityPenalty = {
    low: 0,
    medium: 10,
    high: 25,
    critical: 50,
  };

  return Math.max(
    0,
    baseScore - severityPenalty[this.severity] - this.downvotes
  );
});

// Method to find similar reports
reportSchema.methods.findSimilarReports = async function () {
  const Report = mongoose.model("Report");

  // Find reports with similar tags, location, and time
  const similarReports = await Report.find({
    _id: { $ne: this._id },
    $or: [
      { tags: { $in: this.tags } },
      {
        // Use geoWithin with a spherical radius (in radians) to avoid $near restrictions
        location: {
          $geoWithin: {
            $centerSphere: [
              this.location.coordinates,
              1000 / 6378137, // radius in radians (1000 meters)
            ],
          },
        },
      },
    ],
    timestamp: {
      $gte: new Date(this.timestamp.getTime() - 24 * 60 * 60 * 1000), // within 24 hours
      $lte: new Date(this.timestamp.getTime() + 24 * 60 * 60 * 1000),
    },
  }).limit(5);

  return similarReports;
};

// Method to analyze patterns
reportSchema.methods.analyzePatterns = function () {
  const hour = this.timestamp.getHours();
  const dayOfWeek = this.timestamp.getDay();

  let timeOfDay, dayType, locationType, riskLevel;

  // Time of day analysis
  if (hour >= 6 && hour < 12) timeOfDay = "morning";
  else if (hour >= 12 && hour < 18) timeOfDay = "afternoon";
  else if (hour >= 18 && hour < 22) timeOfDay = "evening";
  else timeOfDay = "night";

  // Day type analysis
  dayType = dayOfWeek >= 1 && dayOfWeek <= 5 ? "weekday" : "weekend";

  // Location type analysis (simplified)
  locationType = this.location.address ? "specific" : "general";

  // Risk level analysis
  if (
    this.severity === "critical" ||
    (timeOfDay === "night" && this.severity === "high")
  ) {
    riskLevel = "high";
  } else if (
    this.severity === "high" ||
    (timeOfDay === "night" && this.severity === "medium")
  ) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  // Generate suggestions
  const suggestions = [];
  if (timeOfDay === "night") {
    suggestions.push("Consider traveling with a companion at night");
  }
  if (this.severity === "high" || this.severity === "critical") {
    suggestions.push("Report to local authorities if not already done");
  }
  if (this.tags.includes("public_transport")) {
    suggestions.push("Use well-lit bus stops and train stations");
  }

  this.patternAnalysis = {
    timeOfDay,
    dayOfWeek: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ][dayOfWeek],
    locationType,
    riskLevel,
    suggestions,
  };

  return this.patternAnalysis;
};

module.exports = mongoose.model("Report", reportSchema);
