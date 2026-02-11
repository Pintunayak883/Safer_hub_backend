const mongoose = require('mongoose');

const forumSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['safety_tips', 'incident_sharing', 'community_support', 'resources', 'general'],
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  tags: [String],
  views: { type: Number, default: 0 },
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] },
    address: String,
    city: String
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['active', 'closed', 'archived'],
    default: 'active'
  },
  moderation: {
    isModerated: { type: Boolean, default: false },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
    moderationNotes: String,
    flaggedContent: [String]
  },
  echoReplies: [{
    originalMessage: String,
    suggestedReply: String,
    similarityScore: Number,
    isUsed: { type: Boolean, default: false }
  }],
  communityInsights: {
    sentimentScore: Number,
    engagementLevel: String,
    trendingTopics: [String],
    helpfulResponses: Number
  }
}, {
  timestamps: true
});

const threadSchema = new mongoose.Schema({
  forum: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Forum',
    required: true
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  parentThread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    default: null
  },
  depth: {
    type: Number,
    default: 0
  },
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  isPinned: {
    type: Boolean,
    default: false
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date,
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video', 'document']
    },
    url: String,
    filename: String
  }],
  mentions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  reactions: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji: String,
    createdAt: { type: Date, default: Date.now }
  }],
  moderation: {
    isModerated: { type: Boolean, default: false },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: Date,
    moderationNotes: String,
    flaggedWords: [String]
  },
  echoSuggestions: [{
    originalContent: String,
    suggestedContent: String,
    similarityScore: Number,
    sourceThread: { type: mongoose.Schema.Types.ObjectId, ref: 'Thread' }
  }]
}, {
  timestamps: true
});

// Indexes
forumSchema.index({ category: 1, createdAt: -1 });
forumSchema.index({ tags: 1 });
forumSchema.index({ location: '2dsphere' });
forumSchema.index({ author: 1, status: 1 });

threadSchema.index({ forum: 1, createdAt: -1 });
threadSchema.index({ parentThread: 1, depth: 1 });
threadSchema.index({ author: 1 });

// Method to find echo replies
threadSchema.methods.findEchoReplies = async function() {
  const Thread = mongoose.model('Thread');
  
  // Find similar threads based on content similarity
  const similarThreads = await Thread.find({
    _id: { $ne: this._id },
    forum: this.forum,
    content: { $regex: new RegExp(this.content.split(' ').slice(0, 3).join('|'), 'i') }
  }).limit(3);
  
  const echoReplies = similarThreads.map(thread => ({
    originalContent: this.content,
    suggestedContent: thread.content,
    similarityScore: this.calculateSimilarity(thread.content),
    sourceThread: thread._id
  }));
  
  return echoReplies;
};

// Method to calculate content similarity
threadSchema.methods.calculateSimilarity = function(otherContent) {
  const words1 = this.content.toLowerCase().split(/\s+/);
  const words2 = otherContent.toLowerCase().split(/\s+/);
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  
  return (intersection.length / union.length) * 100;
};

// Method to moderate content
threadSchema.methods.moderateContent = function() {
  const flaggedWords = ['harassment', 'abuse', 'threat', 'danger'];
  const content = this.content.toLowerCase();
  const foundWords = flaggedWords.filter(word => content.includes(word));
  
  if (foundWords.length > 0) {
    this.moderation.flaggedWords = foundWords;
    this.moderation.isModerated = true;
    this.moderation.moderatedAt = new Date();
  }
  
  return foundWords;
};

// Method to analyze sentiment
threadSchema.methods.analyzeSentiment = function() {
  const positiveWords = ['safe', 'helpful', 'support', 'good', 'great', 'thanks', 'appreciate'];
  const negativeWords = ['unsafe', 'scared', 'worried', 'dangerous', 'bad', 'terrible'];
  
  const content = this.content.toLowerCase();
  const positiveCount = positiveWords.filter(word => content.includes(word)).length;
  const negativeCount = negativeWords.filter(word => content.includes(word)).length;
  
  return {
    score: positiveCount - negativeCount,
    level: positiveCount > negativeCount ? 'positive' : 
           negativeCount > positiveCount ? 'negative' : 'neutral'
  };
};

module.exports = {
  Forum: mongoose.model('Forum', forumSchema),
  Thread: mongoose.model('Thread', threadSchema)
};
