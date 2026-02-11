const mongoose = require("mongoose");

const pulseCheckSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    question: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["safety", "mood", "location", "wellbeing", "custom"],
      required: true,
    },
    response: {
      value: {
        type: String,
        enum: [
          "safe",
          "unsafe",
          "neutral",
          "happy",
          "sad",
          "anxious",
          "confident",
          "scared",
        ],
        required: true,
      },
      text: String,
      confidence: {
        type: Number,
        min: 1,
        max: 10,
        default: 5,
      },
      notes: String,
    },
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: [Number],
      address: String,
      accuracy: Number,
    },
    context: {
      timeOfDay: String,
      dayOfWeek: String,
      weather: String,
      activity: String,
      companions: [String],
    },
    isAnonymous: {
      type: Boolean,
      default: false,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    tags: [String],
    metadata: {
      deviceInfo: String,
      appVersion: String,
      batteryLevel: Number,
      networkType: String,
    },
  },
  {
    timestamps: true,
  }
);

const safetyStreakSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    currentStreak: {
      type: Number,
      default: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
    },
    lastCheckIn: Date,
    streakStartDate: Date,
    totalCheckIns: {
      type: Number,
      default: 0,
    },
    positiveResponses: {
      type: Number,
      default: 0,
    },
    streakMultiplier: {
      type: Number,
      default: 1,
    },
    badges: [
      {
        name: String,
        description: String,
        earnedAt: { type: Date, default: Date.now },
        icon: String,
        rarity: {
          type: String,
          enum: ["common", "uncommon", "rare", "epic", "legendary"],
          default: "common",
        },
      },
    ],
    achievements: [
      {
        title: String,
        description: String,
        unlockedAt: { type: Date, default: Date.now },
        points: Number,
      },
    ],
  },
  {
    timestamps: true,
  }
);

const communityPulseSchema = new mongoose.Schema(
  {
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: [Number],
      radius: Number, // in meters
      address: String,
      neighborhood: String,
      city: String,
    },
    timeRange: {
      start: Date,
      end: Date,
    },
    totalResponses: {
      type: Number,
      default: 0,
    },
    safetyScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    moodScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    responseDistribution: {
      safe: { type: Number, default: 0 },
      unsafe: { type: Number, default: 0 },
      neutral: { type: Number, default: 0 },
    },
    trends: [
      {
        time: Date,
        safetyScore: Number,
        moodScore: Number,
        responseCount: Number,
      },
    ],
    insights: [
      {
        insightType: String,
        description: String,
        confidence: Number,
        generatedAt: { type: Date, default: Date.now },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const pulseScheduleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    frequency: {
      type: String,
      enum: ["random", "hourly", "daily", "weekly", "custom"],
      default: "random",
    },
    customSchedule: {
      days: [Number], // 0-6 for Sunday-Saturday
      times: [String], // HH:MM format
      intervals: [Number], // in minutes
    },
    locationBased: {
      isEnabled: { type: Boolean, default: false },
      locations: [
        {
          type: { type: String, enum: ["Point"], default: "Point" },
          coordinates: [Number],
          radius: Number,
          name: String,
        },
      ],
      triggerDistance: Number, // in meters
    },
    timeBased: {
      isEnabled: { type: Boolean, default: false },
      quietHours: {
        start: String, // HH:MM format
        end: String, // HH:MM format
      },
      preferredTimes: [String], // HH:MM format
    },
    questionBank: [
      {
        question: String,
        type: String,
        weight: Number, // for random selection
        isActive: { type: Boolean, default: true },
      },
    ],
    lastTriggered: Date,
    nextScheduled: Date,
    totalTriggers: { type: Number, default: 0 },
    responseRate: { type: Number, default: 0 }, // percentage
  },
  {
    timestamps: true,
  }
);

// Indexes
pulseCheckSchema.index({ user: 1, createdAt: -1 });
pulseCheckSchema.index({ location: "2dsphere" });
pulseCheckSchema.index({ type: 1, createdAt: -1 });
pulseCheckSchema.index({ isPublic: 1, createdAt: -1 });

safetyStreakSchema.index({ user: 1 });
safetyStreakSchema.index({ currentStreak: -1 });

communityPulseSchema.index({ location: "2dsphere" });
communityPulseSchema.index({ timeRange: 1 });
communityPulseSchema.index({ safetyScore: -1 });

pulseScheduleSchema.index({ user: 1, isActive: 1 });
pulseScheduleSchema.index({ nextScheduled: 1 });

// Method to calculate safety score
pulseCheckSchema.methods.calculateSafetyScore = function () {
  const safetyValues = {
    safe: 100,
    neutral: 50,
    unsafe: 0,
  };

  const baseScore = safetyValues[this.response.value] || 50;
  const confidenceMultiplier = this.response.confidence / 10;

  return Math.round(baseScore * confidenceMultiplier);
};

// Method to update streak
safetyStreakSchema.methods.updateStreak = function (isPositive) {
  const now = new Date();
  const lastCheckIn = this.lastCheckIn;

  // Check if this is a continuation of streak
  const isStreakContinuing =
    lastCheckIn && now - lastCheckIn <= 24 * 60 * 60 * 1000; // within 24 hours

  if (isPositive) {
    this.positiveResponses += 1;

    if (isStreakContinuing) {
      this.currentStreak += 1;
    } else {
      this.currentStreak = 1;
      this.streakStartDate = now;
    }

    this.longestStreak = Math.max(this.longestStreak, this.currentStreak);
  } else {
    // Reset streak on negative response
    this.currentStreak = 0;
    this.streakStartDate = null;
  }

  this.lastCheckIn = now;
  this.totalCheckIns += 1;

  // Calculate response rate
  this.responseRate = (this.positiveResponses / this.totalCheckIns) * 100;

  return this.save();
};

// Method to check for badge eligibility
safetyStreakSchema.methods.checkBadgeEligibility = function () {
  const badges = [];

  // Streak badges
  if (
    this.currentStreak >= 7 &&
    !this.badges.find((b) => b.name === "Week Warrior")
  ) {
    badges.push({
      name: "Week Warrior",
      description: "7-day safety streak",
      icon: "🏆",
      rarity: "uncommon",
    });
  }

  if (
    this.currentStreak >= 30 &&
    !this.badges.find((b) => b.name === "Monthly Guardian")
  ) {
    badges.push({
      name: "Monthly Guardian",
      description: "30-day safety streak",
      icon: "🛡️",
      rarity: "rare",
    });
  }

  if (
    this.currentStreak >= 100 &&
    !this.badges.find((b) => b.name === "Century Champion")
  ) {
    badges.push({
      name: "Century Champion",
      description: "100-day safety streak",
      icon: "👑",
      rarity: "legendary",
    });
  }

  // Response rate badges
  if (
    this.responseRate >= 90 &&
    !this.badges.find((b) => b.name === "Consistent Checker")
  ) {
    badges.push({
      name: "Consistent Checker",
      description: "90% response rate",
      icon: "✅",
      rarity: "uncommon",
    });
  }

  // Add new badges
  this.badges.push(...badges);

  return badges;
};

// Method to calculate community pulse
communityPulseSchema.methods.calculateCommunityPulse = function () {
  const totalResponses = this.totalResponses;

  if (totalResponses === 0) {
    this.safetyScore = 50;
    this.moodScore = 50;
    return;
  }

  // Calculate safety score based on response distribution
  const safeWeight = this.responseDistribution.safe * 100;
  const unsafeWeight = this.responseDistribution.unsafe * 0;
  const neutralWeight = this.responseDistribution.neutral * 50;

  this.safetyScore = Math.round(
    (safeWeight + unsafeWeight + neutralWeight) / totalResponses
  );

  // Calculate mood score (simplified)
  this.moodScore = Math.max(0, Math.min(100, this.safetyScore + 10));

  return {
    safetyScore: this.safetyScore,
    moodScore: this.moodScore,
    totalResponses: this.totalResponses,
  };
};

// Method to generate insights
communityPulseSchema.methods.generateInsights = function () {
  const insights = [];

  if (this.safetyScore >= 80) {
    insights.push({
      insightType: "positive",
      description: "This area shows high safety confidence",
      confidence: 0.9,
    });
  } else if (this.safetyScore <= 30) {
    insights.push({
      insightType: "concern",
      description: "This area may need attention for safety",
      confidence: 0.8,
    });
  }

  if (this.totalResponses >= 10) {
    insights.push({
      insightType: "data_quality",
      description: "Good community participation in this area",
      confidence: 0.7,
    });
  }

  this.insights = insights;
  return insights;
};

// Method to schedule next pulse check
pulseScheduleSchema.methods.scheduleNext = function () {
  const now = new Date();
  let nextScheduled;

  switch (this.frequency) {
    case "random":
      // Random time within next 24 hours
      const randomHours = Math.random() * 24;
      nextScheduled = new Date(now.getTime() + randomHours * 60 * 60 * 1000);
      break;
    case "hourly":
      nextScheduled = new Date(now.getTime() + 60 * 60 * 1000);
      break;
    case "daily":
      nextScheduled = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      break;
    case "weekly":
      nextScheduled = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case "custom":
      // Use custom schedule logic
      nextScheduled = this.calculateCustomSchedule();
      break;
    default:
      nextScheduled = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }

  this.nextScheduled = nextScheduled;
  return nextScheduled;
};

// Method to calculate custom schedule
pulseScheduleSchema.methods.calculateCustomSchedule = function () {
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  // Find next scheduled time based on custom settings
  for (let day = 0; day < 7; day++) {
    const checkDay = (currentDay + day) % 7;

    if (this.customSchedule.days.includes(checkDay)) {
      for (const timeStr of this.customSchedule.times) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const scheduledTime = hours * 60 + minutes;

        if (day === 0 && scheduledTime > currentTime) {
          return new Date(
            now.getTime() + (scheduledTime - currentTime) * 60 * 1000
          );
        } else if (day > 0) {
          return new Date(
            now.getTime() +
              day * 24 * 60 * 60 * 1000 +
              scheduledTime * 60 * 1000
          );
        }
      }
    }
  }

  // Default to next week
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
};

module.exports = {
  PulseCheck: mongoose.model("PulseCheck", pulseCheckSchema),
  SafetyStreak: mongoose.model("SafetyStreak", safetyStreakSchema),
  CommunityPulse: mongoose.model("CommunityPulse", communityPulseSchema),
  PulseSchedule: mongoose.model("PulseSchedule", pulseScheduleSchema),
};
