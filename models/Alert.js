const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['whisper', 'emergency', 'check_in', 'pulse', 'guardian'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
    address: String,
    accuracy: Number
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['active', 'acknowledged', 'escalated', 'resolved', 'expired'],
    default: 'active'
  },
  recipients: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    contactMethod: {
      type: String,
      enum: ['sms', 'email', 'push', 'all']
    },
    sentAt: Date,
    acknowledgedAt: Date,
    responseTime: Number // in minutes
  }],
  escalationChain: [{
    level: Number,
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    triggeredAt: Date,
    responseTime: Number,
    autoEscalate: { type: Boolean, default: true }
  }],
  autoEscalateAfter: {
    type: Number,
    default: 30 // minutes
  },
  isSilent: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: function() {
      return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }
  },
  metadata: {
    deviceInfo: String,
    appVersion: String,
    batteryLevel: Number,
    networkType: String
  },
  responseData: {
    totalResponses: { type: Number, default: 0 },
    averageResponseTime: Number,
    firstResponseTime: Number,
    lastResponseTime: Number
  }
}, {
  timestamps: true
});

const whisperChainSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  chain: [{
    contact: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    priority: Number,
    responseTime: Number, // average response time in minutes
    lastContacted: Date,
    isActive: { type: Boolean, default: true }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  lastUsed: Date,
  totalUses: { type: Number, default: 0 },
  successRate: { type: Number, default: 0 }
}, {
  timestamps: true
});

// Indexes
alertSchema.index({ user: 1, status: 1 });
alertSchema.index({ location: '2dsphere' });
alertSchema.index({ createdAt: -1 });
alertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

whisperChainSchema.index({ user: 1 });

// Method to escalate alert
alertSchema.methods.escalate = async function() {
  const nextLevel = this.escalationChain.length + 1;
  const nextContact = this.escalationChain.find(contact => contact.level === nextLevel);
  
  if (nextContact) {
    nextContact.triggeredAt = new Date();
    this.status = 'escalated';
    await this.save();
    return nextContact;
  }
  
  return null;
};

// Method to calculate response metrics
alertSchema.methods.calculateResponseMetrics = function() {
  const responses = this.recipients.filter(r => r.acknowledgedAt);
  
  if (responses.length === 0) return;
  
  const responseTimes = responses.map(r => r.responseTime).filter(t => t);
  
  this.responseData = {
    totalResponses: responses.length,
    averageResponseTime: responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0,
    firstResponseTime: Math.min(...responseTimes),
    lastResponseTime: Math.max(...responseTimes)
  };
  
  return this.responseData;
};

// Method to check if alert should auto-escalate
alertSchema.methods.shouldAutoEscalate = function() {
  const now = new Date();
  const timeSinceCreation = (now - this.createdAt) / (1000 * 60); // minutes
  
  return timeSinceCreation >= this.autoEscalateAfter && this.status === 'active';
};

// Method to update whisper chain based on response
whisperChainSchema.methods.updateChainPerformance = function(contactId, responseTime, wasSuccessful) {
  const contact = this.chain.find(c => c.contact.toString() === contactId.toString());
  
  if (contact) {
    contact.responseTime = contact.responseTime 
      ? (contact.responseTime + responseTime) / 2 
      : responseTime;
    contact.lastContacted = new Date();
    
    if (wasSuccessful) {
      // Move successful contact up in priority
      contact.priority = Math.max(1, contact.priority - 1);
    } else {
      // Move unsuccessful contact down in priority
      contact.priority = contact.priority + 1;
    }
  }
  
  // Recalculate success rate
  const successfulContacts = this.chain.filter(c => c.responseTime > 0);
  this.successRate = successfulContacts.length / this.chain.length;
  
  return this.save();
};

// Method to get next contact in chain
whisperChainSchema.methods.getNextContact = function() {
  const activeContacts = this.chain
    .filter(c => c.isActive)
    .sort((a, b) => a.priority - b.priority);
  
  return activeContacts[0];
};

// Method to optimize chain based on performance
whisperChainSchema.methods.optimizeChain = function() {
  // Sort by performance (response time and success rate)
  this.chain.sort((a, b) => {
    const aScore = a.responseTime || 999;
    const bScore = b.responseTime || 999;
    return aScore - bScore;
  });
  
  // Update priorities based on new order
  this.chain.forEach((contact, index) => {
    contact.priority = index + 1;
  });
  
  return this.save();
};

module.exports = {
  Alert: mongoose.model('Alert', alertSchema),
  WhisperChain: mongoose.model('WhisperChain', whisperChainSchema)
};
