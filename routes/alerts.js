const express = require('express');
const { body, validationResult } = require('express-validator');
const { Alert, WhisperChain } = require('../models/Alert');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Create a new alert
router.post('/', auth, [
  body('type').isIn(['whisper', 'emergency', 'check_in', 'pulse', 'guardian']).withMessage('Invalid alert type'),
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be between 5 and 100 characters'),
  body('message').trim().isLength({ min: 10, max: 500 }).withMessage('Message must be between 10 and 500 characters'),
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of 2 numbers'),
  body('severity').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid severity level'),
  body('isSilent').optional().isBoolean().withMessage('Is silent must be boolean'),
  body('autoEscalateAfter').optional().isInt({ min: 5, max: 120 }).withMessage('Auto escalate after must be between 5 and 120 minutes')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      type,
      title,
      message,
      coordinates,
      address,
      accuracy,
      severity = 'medium',
      isSilent = false,
      autoEscalateAfter = 30,
      metadata
    } = req.body;

    const alert = new Alert({
      user: req.user.id,
      type,
      title,
      message,
      location: {
        type: 'Point',
        coordinates,
        address,
        accuracy
      },
      severity,
      isSilent,
      autoEscalateAfter,
      metadata
    });

    // Get user's whisper chain for whisper alerts
    if (type === 'whisper') {
      const user = await User.findById(req.user.id);
      const whisperChain = await WhisperChain.findOne({ user: req.user.id, isActive: true });
      
      if (whisperChain && whisperChain.chain.length > 0) {
        // Set up escalation chain
        alert.escalationChain = whisperChain.chain.map((contact, index) => ({
          level: index + 1,
          contact: contact.contact,
          autoEscalate: true
        }));

        // Set recipients from whisper chain
        alert.recipients = whisperChain.chain.map(contact => ({
          user: contact.contact,
          contactMethod: 'all'
        }));
      }
    }

    await alert.save();

    res.status(201).json({
      message: 'Alert created successfully',
      alert
    });
  } catch (error) {
    console.error('Create alert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's alerts
router.get('/my-alerts', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, type, status } = req.query;
    const query = { user: req.user.id };
    
    if (type) query.type = type;
    if (status) query.status = status;

    const alerts = await Alert.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('recipients.user', 'name email profile.phone');

    const total = await Alert.countDocuments(query);

    res.json({
      alerts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get user alerts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get alert by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id)
      .populate('recipients.user', 'name email profile.phone')
      .populate('escalationChain.contact', 'name email profile.phone');

    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    // Check if user owns the alert or is a recipient
    if (alert.user.toString() !== req.user.id && 
        !alert.recipients.some(r => r.user.toString() === req.user.id)) {
      return res.status(403).json({ message: 'Not authorized to view this alert' });
    }

    res.json(alert);
  } catch (error) {
    console.error('Get alert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Acknowledge alert
router.post('/:id/acknowledge', auth, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    // Check if user is a recipient
    const recipient = alert.recipients.find(r => r.user.toString() === req.user.id);
    if (!recipient) {
      return res.status(403).json({ message: 'Not authorized to acknowledge this alert' });
    }

    // Update recipient acknowledgment
    recipient.acknowledgedAt = new Date();
    recipient.responseTime = (new Date() - alert.createdAt) / (1000 * 60); // minutes

    // Update alert status if first acknowledgment
    if (alert.status === 'active') {
      alert.status = 'acknowledged';
    }

    await alert.save();

    // Update whisper chain performance
    if (alert.type === 'whisper') {
      const whisperChain = await WhisperChain.findOne({ user: alert.user, isActive: true });
      if (whisperChain) {
        await whisperChain.updateChainPerformance(req.user.id, recipient.responseTime, true);
      }
    }

    res.json({
      message: 'Alert acknowledged successfully',
      responseTime: recipient.responseTime
    });
  } catch (error) {
    console.error('Acknowledge alert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Escalate alert
router.post('/:id/escalate', auth, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    // Check if user owns the alert
    if (alert.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to escalate this alert' });
    }

    const nextContact = await alert.escalate();
    
    if (nextContact) {
      res.json({
        message: 'Alert escalated successfully',
        nextContact
      });
    } else {
      res.json({
        message: 'No more contacts to escalate to',
        status: 'fully_escalated'
      });
    }
  } catch (error) {
    console.error('Escalate alert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update alert status
router.put('/:id/status', auth, [
  body('status').isIn(['active', 'acknowledged', 'escalated', 'resolved', 'expired']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status } = req.body;
    const alert = await Alert.findById(req.params.id);
    
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }

    // Check if user owns the alert
    if (alert.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this alert' });
    }

    alert.status = status;
    await alert.save();

    res.json({
      message: 'Alert status updated successfully',
      status: alert.status
    });
  } catch (error) {
    console.error('Update alert status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create whisper chain
router.post('/whisper-chain', auth, [
  body('contacts').isArray({ min: 1 }).withMessage('At least one contact is required'),
  body('contacts.*.contactId').isMongoId().withMessage('Valid contact ID is required'),
  body('contacts.*.priority').optional().isInt({ min: 1, max: 10 }).withMessage('Priority must be between 1 and 10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contacts } = req.body;

    // Check if contacts exist
    const contactIds = contacts.map(c => c.contactId);
    const existingContacts = await User.find({ _id: { $in: contactIds } });
    
    if (existingContacts.length !== contactIds.length) {
      return res.status(400).json({ message: 'Some contacts not found' });
    }

    // Create or update whisper chain
    let whisperChain = await WhisperChain.findOne({ user: req.user.id, isActive: true });
    
    if (whisperChain) {
      whisperChain.chain = contacts.map(contact => ({
        contact: contact.contactId,
        priority: contact.priority || 1,
        responseTime: 0,
        lastContacted: new Date(),
        isActive: true
      }));
    } else {
      whisperChain = new WhisperChain({
        user: req.user.id,
        chain: contacts.map(contact => ({
          contact: contact.contactId,
          priority: contact.priority || 1,
          responseTime: 0,
          lastContacted: new Date(),
          isActive: true
        }))
      });
    }

    await whisperChain.save();

    res.json({
      message: 'Whisper chain created successfully',
      whisperChain
    });
  } catch (error) {
    console.error('Create whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get whisper chain
router.get('/whisper-chain', auth, async (req, res) => {
  try {
    const whisperChain = await WhisperChain.findOne({ user: req.user.id, isActive: true })
      .populate('chain.contact', 'name email profile.phone');

    if (!whisperChain) {
      return res.json({ chain: [] });
    }

    res.json(whisperChain);
  } catch (error) {
    console.error('Get whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update whisper chain
router.put('/whisper-chain', auth, [
  body('contacts').isArray({ min: 1 }).withMessage('At least one contact is required'),
  body('contacts.*.contactId').isMongoId().withMessage('Valid contact ID is required'),
  body('contacts.*.priority').optional().isInt({ min: 1, max: 10 }).withMessage('Priority must be between 1 and 10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contacts } = req.body;
    const whisperChain = await WhisperChain.findOne({ user: req.user.id, isActive: true });
    
    if (!whisperChain) {
      return res.status(404).json({ message: 'Whisper chain not found' });
    }

    // Update chain
    whisperChain.chain = contacts.map(contact => ({
      contact: contact.contactId,
      priority: contact.priority || 1,
      responseTime: 0,
      lastContacted: new Date(),
      isActive: true
    }));

    await whisperChain.save();

    res.json({
      message: 'Whisper chain updated successfully',
      whisperChain
    });
  } catch (error) {
    console.error('Update whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Optimize whisper chain
router.post('/whisper-chain/optimize', auth, async (req, res) => {
  try {
    const whisperChain = await WhisperChain.findOne({ user: req.user.id, isActive: true });
    
    if (!whisperChain) {
      return res.status(404).json({ message: 'Whisper chain not found' });
    }

    await whisperChain.optimizeChain();

    res.json({
      message: 'Whisper chain optimized successfully',
      whisperChain
    });
  } catch (error) {
    console.error('Optimize whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get alert statistics
router.get('/stats/overview', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const stats = await Alert.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalAlerts: { $sum: 1 },
          alertsByType: {
            $push: {
              type: '$type',
              status: '$status',
              severity: '$severity'
            }
          },
          averageResponseTime: { $avg: '$responseData.averageResponseTime' }
        }
      }
    ]);

    const whisperChain = await WhisperChain.findOne({ user: userId, isActive: true });

    res.json({
      alerts: stats[0] || {
        totalAlerts: 0,
        alertsByType: [],
        averageResponseTime: 0
      },
      whisperChain: whisperChain ? {
        totalContacts: whisperChain.chain.length,
        successRate: whisperChain.successRate,
        totalUses: whisperChain.totalUses
      } : null
    });
  } catch (error) {
    console.error('Get alert stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check for alerts that need auto-escalation
router.get('/check-escalation', auth, async (req, res) => {
  try {
    const alerts = await Alert.find({
      user: req.user.id,
      status: 'active'
    });

    const alertsToEscalate = alerts.filter(alert => alert.shouldAutoEscalate());

    for (const alert of alertsToEscalate) {
      await alert.escalate();
    }

    res.json({
      message: 'Escalation check completed',
      escalatedCount: alertsToEscalate.length
    });
  } catch (error) {
    console.error('Check escalation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
