const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const guardianSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  guardian: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  relationship: {
    type: String,
    required: true,
    enum: ['family', 'friend', 'partner', 'colleague', 'other']
  },
  customRelationship: String,
  trustLevel: {
    type: Number,
    min: 1,
    max: 10,
    default: 5
  },
  permissions: {
    viewLocation: { type: Boolean, default: true },
    receiveAlerts: { type: Boolean, default: true },
    accessReports: { type: Boolean, default: false },
    emergencyContact: { type: Boolean, default: true }
  },
  contactPreferences: {
    primaryMethod: {
      type: String,
      enum: ['sms', 'email', 'call', 'all'],
      default: 'all'
    },
    quietHours: {
      start: String, // HH:MM format
      end: String,   // HH:MM format
      timezone: String
    },
    emergencyOnly: { type: Boolean, default: false }
  },
  syncSettings: {
    autoSync: { type: Boolean, default: true },
    syncFrequency: {
      type: String,
      enum: ['realtime', 'hourly', 'daily', 'weekly'],
      default: 'realtime'
    },
    lastSync: Date,
    syncToken: String
  },
  affirmationLock: {
    isEnabled: { type: Boolean, default: false },
    mantra: String, // hashed
    hint: String,
    lastUsed: Date,
    failedAttempts: { type: Number, default: 0 }
  },
  checkInSettings: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'custom'],
      default: 'weekly'
    },
    customDays: [Number], // 0-6 for Sunday-Saturday
    customTime: String, // HH:MM format
    reminderMethod: {
      type: String,
      enum: ['email', 'sms', 'both'],
      default: 'both'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastInteraction: Date,
  interactionCount: { type: Number, default: 0 },
  responseRate: { type: Number, default: 0 }, // percentage
  averageResponseTime: Number // in minutes
}, {
  timestamps: true
});

const syncRitualSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  guardian: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['check_in', 'affirmation', 'sync', 'emergency_test'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'expired'],
    default: 'pending'
  },
  message: String,
  response: String,
  responseTime: Number, // in minutes
  isAutomated: { type: Boolean, default: false },
  scheduledFor: Date,
  completedAt: Date,
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    }
  },
  metadata: {
    deviceInfo: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: [Number]
    },
    batteryLevel: Number
  }
}, {
  timestamps: true
});

// Indexes
guardianSchema.index({ user: 1, guardian: 1 }, { unique: true });
guardianSchema.index({ user: 1, isActive: 1 });
guardianSchema.index({ guardian: 1, isActive: 1 });

syncRitualSchema.index({ user: 1, guardian: 1, status: 1 });
syncRitualSchema.index({ scheduledFor: 1 });
syncRitualSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Hash affirmation mantra
guardianSchema.pre('save', async function(next) {
  if (this.isModified('affirmationLock.mantra') && this.affirmationLock.mantra) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.affirmationLock.mantra = await bcrypt.hash(this.affirmationLock.mantra, salt);
    } catch (error) {
      next(error);
    }
  }
  next();
});

// Method to verify affirmation mantra
guardianSchema.methods.verifyAffirmation = async function(mantra) {
  if (!this.affirmationLock.isEnabled || !this.affirmationLock.mantra) {
    return false;
  }
  
  try {
    const isValid = await bcrypt.compare(mantra, this.affirmationLock.mantra);
    
    if (isValid) {
      this.affirmationLock.lastUsed = new Date();
      this.affirmationLock.failedAttempts = 0;
    } else {
      this.affirmationLock.failedAttempts += 1;
    }
    
    await this.save();
    return isValid;
  } catch (error) {
    return false;
  }
};

// Method to update response metrics
guardianSchema.methods.updateResponseMetrics = function(responseTime, wasSuccessful) {
  this.lastInteraction = new Date();
  this.interactionCount += 1;
  
  if (wasSuccessful) {
    // Update average response time
    this.averageResponseTime = this.averageResponseTime 
      ? (this.averageResponseTime + responseTime) / 2 
      : responseTime;
    
    // Update response rate
    const successfulInteractions = this.interactionCount * (this.responseRate / 100);
    this.responseRate = ((successfulInteractions + 1) / this.interactionCount) * 100;
  } else {
    // Decrease response rate for failed interactions
    this.responseRate = Math.max(0, this.responseRate - 5);
  }
  
  return this.save();
};

// Method to check if sync is needed
guardianSchema.methods.needsSync = function() {
  if (!this.syncSettings.autoSync) return false;
  
  const now = new Date();
  const lastSync = this.syncSettings.lastSync;
  
  if (!lastSync) return true;
  
  const timeSinceSync = now - lastSync;
  const syncInterval = this.getSyncInterval();
  
  return timeSinceSync >= syncInterval;
};

// Method to get sync interval in milliseconds
guardianSchema.methods.getSyncInterval = function() {
  const intervals = {
    realtime: 0,
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000
  };
  
  return intervals[this.syncSettings.syncFrequency] || intervals.daily;
};

// Method to generate sync token
guardianSchema.methods.generateSyncToken = function() {
  const token = Math.random().toString(36).substring(2, 15) + 
                Math.random().toString(36).substring(2, 15);
  this.syncSettings.syncToken = token;
  this.syncSettings.lastSync = new Date();
  return token;
};

// Method to validate sync token
guardianSchema.methods.validateSyncToken = function(token) {
  return this.syncSettings.syncToken === token;
};

// Method to schedule next check-in
syncRitualSchema.methods.scheduleNext = function() {
  const now = new Date();
  let nextCheckIn;
  
  switch (this.type) {
    case 'check_in':
      nextCheckIn = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
      break;
    case 'affirmation':
      nextCheckIn = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
      break;
    case 'sync':
      nextCheckIn = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      break;
    default:
      nextCheckIn = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  
  return nextCheckIn;
};

// Method to check if ritual is overdue
syncRitualSchema.methods.isOverdue = function() {
  const now = new Date();
  return now > this.scheduledFor && this.status === 'pending';
};

// Method to calculate response time
syncRitualSchema.methods.calculateResponseTime = function() {
  if (this.completedAt && this.createdAt) {
    this.responseTime = (this.completedAt - this.createdAt) / (1000 * 60); // minutes
  }
  return this.responseTime;
};

module.exports = {
  Guardian: mongoose.model('Guardian', guardianSchema),
  SyncRitual: mongoose.model('SyncRitual', syncRitualSchema)
};
