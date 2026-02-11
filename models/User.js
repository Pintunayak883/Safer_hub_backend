const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: function() {
      return !this.googleId;
    }
  },
  googleId: {
    type: String,
    sparse: true
  },
  role: {
    type: String,
    enum: ['user', 'trusted_contact', 'admin'],
    default: 'user'
  },
  profile: {
    phone: String,
    dateOfBirth: Date,
    emergencyContacts: [{
      name: String,
      phone: String,
      relationship: String,
      priority: { type: Number, default: 1 }
    }],
    safetyPreferences: {
      shareLocation: { type: Boolean, default: true },
      autoAlertThreshold: { type: Number, default: 30 }, // minutes
      preferredContactMethod: {
        type: String,
        enum: ['sms', 'email', 'both'],
        default: 'both'
      }
    },
    avatar: String,
    bio: String,
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }
    },
    isLocationShared: { type: Boolean, default: false },
    lastActive: { type: Date, default: Date.now }
  },
  safetyStreak: {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastCheckIn: Date
  },
  badges: [{
    name: String,
    description: String,
    earnedAt: { type: Date, default: Date.now },
    icon: String
  }],
  whisperChain: [{
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    priority: Number,
    responseTime: Number, // average response time in minutes
    lastContacted: Date
  }],
  isActive: { type: Boolean, default: true },
  emailVerified: { type: Boolean, default: false },
  lastLogin: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Index for geospatial queries
userSchema.index({ 'profile.location': '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update last active
userSchema.methods.updateLastActive = function() {
  this.profile.lastActive = new Date();
  this.lastLogin = new Date();
  return this.save();
};

// Add to whisper chain
userSchema.methods.addToWhisperChain = function(contactId, priority = 1) {
  const existingContact = this.whisperChain.find(contact => 
    contact.contactId.toString() === contactId.toString()
  );
  
  if (!existingContact) {
    this.whisperChain.push({
      contactId,
      priority,
      responseTime: 0,
      lastContacted: new Date()
    });
  }
  
  return this.save();
};

// Update whisper chain response time
userSchema.methods.updateWhisperResponseTime = function(contactId, responseTime) {
  const contact = this.whisperChain.find(c => 
    c.contactId.toString() === contactId.toString()
  );
  
  if (contact) {
    contact.responseTime = contact.responseTime 
      ? (contact.responseTime + responseTime) / 2 
      : responseTime;
    contact.lastContacted = new Date();
  }
  
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
