const express = require('express');
const { body, validationResult } = require('express-validator');
const { Forum, Thread } = require('../models/Forum');
const auth = require('../middleware/auth');
const router = express.Router();

// Create a new forum post
router.post('/', auth, [
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be between 5 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  body('category').isIn(['safety_tips', 'incident_sharing', 'community_support', 'resources', 'general']).withMessage('Invalid category'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  body('isAnonymous').optional().isBoolean().withMessage('Is anonymous must be boolean'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority level')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      category,
      tags = [],
      isAnonymous = false,
      priority = 'medium',
      location
    } = req.body;

    const forum = new Forum({
      title,
      description,
      category,
      author: req.user.id,
      tags,
      isAnonymous,
      priority,
      location: location ? {
        type: 'Point',
        coordinates: location.coordinates,
        address: location.address,
        city: location.city
      } : undefined
    });

    await forum.save();
    await forum.populate('author', 'name profile.avatar');

    res.status(201).json({
      message: 'Forum post created successfully',
      forum
    });
  } catch (error) {
    console.error('Create forum post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get forum posts
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      category, 
      city, 
      radius = 1000,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const query = { status: 'active' };
    
    if (category) query.category = category;
    if (city) query['location.city'] = city;

    let forums;
    
    if (req.query.coordinates) {
      const coordinates = JSON.parse(req.query.coordinates);
      forums = await Forum.find({
        ...query,
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: radius
          }
        }
      });
    } else {
      forums = await Forum.find(query);
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    forums = await Forum.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('author', 'name profile.avatar')
      .populate('moderation.moderatedBy', 'name');

    const total = await Forum.countDocuments(query);

    res.json({
      forums,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get forum posts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get forum post by ID
router.get('/:id', async (req, res) => {
  try {
    const forum = await Forum.findById(req.params.id)
      .populate('author', 'name profile.avatar')
      .populate('moderation.moderatedBy', 'name');

    if (!forum) {
      return res.status(404).json({ message: 'Forum post not found' });
    }

    // Increment view count
    forum.views += 1;
    await forum.save();

    res.json(forum);
  } catch (error) {
    console.error('Get forum post error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create a thread (reply to forum post)
router.post('/:id/threads', auth, [
  body('content').trim().isLength({ min: 1, max: 1000 }).withMessage('Content must be between 1 and 1000 characters'),
  body('isAnonymous').optional().isBoolean().withMessage('Is anonymous must be boolean'),
  body('parentThread').optional().isMongoId().withMessage('Invalid parent thread ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { content, isAnonymous = false, parentThread } = req.body;
    const forumId = req.params.id;

    // Check if forum exists
    const forum = await Forum.findById(forumId);
    if (!forum) {
      return res.status(404).json({ message: 'Forum post not found' });
    }

    // Calculate depth
    let depth = 0;
    if (parentThread) {
      const parent = await Thread.findById(parentThread);
      if (parent) {
        depth = parent.depth + 1;
      }
    }

    const thread = new Thread({
      forum: forumId,
      author: req.user.id,
      content,
      isAnonymous,
      parentThread: parentThread || null,
      depth
    });

    // Moderate content
    const flaggedWords = thread.moderateContent();
    if (flaggedWords.length > 0) {
      thread.moderation.isModerated = true;
      thread.moderation.moderatedAt = new Date();
    }

    await thread.save();
    await thread.populate('author', 'name profile.avatar');

    // Find echo replies
    const echoReplies = await thread.findEchoReplies();
    thread.echoSuggestions = echoReplies;
    await thread.save();

    res.status(201).json({
      message: 'Thread created successfully',
      thread
    });
  } catch (error) {
    console.error('Create thread error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get threads for a forum post
router.get('/:id/threads', async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'asc' } = req.query;
    const forumId = req.params.id;

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const threads = await Thread.find({ forum: forumId })
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('author', 'name profile.avatar')
      .populate('mentions', 'name profile.avatar');

    const total = await Thread.countDocuments({ forum: forumId });

    res.json({
      threads,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get threads error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Vote on forum post
router.post('/:id/vote', auth, [
  body('vote').isIn(['up', 'down']).withMessage('Vote must be either up or down')
], async (req, res) => {
  try {
    const { vote } = req.body;
    const forum = await Forum.findById(req.params.id);
    
    if (!forum) {
      return res.status(404).json({ message: 'Forum post not found' });
    }

    if (vote === 'up') {
      forum.upvotes += 1;
    } else {
      forum.downvotes += 1;
    }

    await forum.save();

    res.json({
      message: 'Vote recorded successfully',
      upvotes: forum.upvotes,
      downvotes: forum.downvotes
    });
  } catch (error) {
    console.error('Vote on forum error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Vote on thread
router.post('/threads/:id/vote', auth, [
  body('vote').isIn(['up', 'down']).withMessage('Vote must be either up or down')
], async (req, res) => {
  try {
    const { vote } = req.body;
    const thread = await Thread.findById(req.params.id);
    
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    if (vote === 'up') {
      thread.upvotes += 1;
    } else {
      thread.downvotes += 1;
    }

    await thread.save();

    res.json({
      message: 'Vote recorded successfully',
      upvotes: thread.upvotes,
      downvotes: thread.downvotes
    });
  } catch (error) {
    console.error('Vote on thread error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add reaction to thread
router.post('/threads/:id/reactions', auth, [
  body('emoji').trim().isLength({ min: 1, max: 10 }).withMessage('Emoji must be between 1 and 10 characters')
], async (req, res) => {
  try {
    const { emoji } = req.body;
    const thread = await Thread.findById(req.params.id);
    
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    // Check if user already reacted with this emoji
    const existingReaction = thread.reactions.find(
      r => r.user.toString() === req.user.id && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove existing reaction
      thread.reactions = thread.reactions.filter(
        r => !(r.user.toString() === req.user.id && r.emoji === emoji)
      );
    } else {
      // Add new reaction
      thread.reactions.push({
        user: req.user.id,
        emoji
      });
    }

    await thread.save();

    res.json({
      message: 'Reaction updated successfully',
      reactions: thread.reactions
    });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get echo replies for a thread
router.get('/threads/:id/echo-replies', async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.id);
    
    if (!thread) {
      return res.status(404).json({ message: 'Thread not found' });
    }

    const echoReplies = await thread.findEchoReplies();

    res.json(echoReplies);
  } catch (error) {
    console.error('Get echo replies error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get forum statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await Forum.aggregate([
      {
        $group: {
          _id: null,
          totalForums: { $sum: 1 },
          totalViews: { $sum: '$views' },
          totalUpvotes: { $sum: '$upvotes' },
          forumsByCategory: {
            $push: {
              category: '$category',
              priority: '$priority'
            }
          }
        }
      }
    ]);

    const threadStats = await Thread.aggregate([
      {
        $group: {
          _id: null,
          totalThreads: { $sum: 1 },
          totalUpvotes: { $sum: '$upvotes' },
          averageDepth: { $avg: '$depth' }
        }
      }
    ]);

    res.json({
      forums: stats[0] || {
        totalForums: 0,
        totalViews: 0,
        totalUpvotes: 0,
        forumsByCategory: []
      },
      threads: threadStats[0] || {
        totalThreads: 0,
        totalUpvotes: 0,
        averageDepth: 0
      }
    });
  } catch (error) {
    console.error('Get forum stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search forums
router.get('/search', async (req, res) => {
  try {
    const { q, category, city, page = 1, limit = 10 } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const query = {
      status: 'active',
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [new RegExp(q, 'i')] } }
      ]
    };

    if (category) query.category = category;
    if (city) query['location.city'] = city;

    const forums = await Forum.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('author', 'name profile.avatar');

    const total = await Forum.countDocuments(query);

    res.json({
      forums,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Search forums error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
