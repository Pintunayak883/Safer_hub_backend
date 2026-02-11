const express = require('express');
const { body, validationResult } = require('express-validator');
const { Guardian, SyncRitual } = require('../models/Guardian');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Add a guardian
router.post('/', auth, [
  body('guardianId').isMongoId().withMessage('Valid guardian ID is required'),
  body('relationship').isIn(['family', 'friend', 'partner', 'colleague', 'other']).withMessage('Invalid relationship'),
  body('customRelationship').optional().trim().isLength({ max: 50 }).withMessage('Custom relationship must be less than 50 characters'),
  body('trustLevel').optional().isInt({ min: 1, max: 10 }).withMessage('Trust level must be between 1 and 10'),
  body('permissions.viewLocation').optional().isBoolean().withMessage('View location must be boolean'),
  body('permissions.receiveAlerts').optional().isBoolean().withMessage('Receive alerts must be boolean'),
  body('permissions.accessReports').optional().isBoolean().withMessage('Access reports must be boolean'),
  body('permissions.emergencyContact').optional().isBoolean().withMessage('Emergency contact must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      guardianId,
      relationship,
      customRelationship,
      trustLevel = 5,
      permissions = {},
      contactPreferences = {},
      syncSettings = {},
      checkInSettings = {}
    } = req.body;

    // Check if guardian exists
    const guardian = await User.findById(guardianId);
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if already a guardian
    const existingGuardian = await Guardian.findOne({
      user: req.user.id,
      guardian: guardianId
    });

    if (existingGuardian) {
      return res.status(400).json({ message: 'This user is already a guardian' });
    }

    const guardianProfile = new Guardian({
      user: req.user.id,
      guardian: guardianId,
      relationship,
      customRelationship,
      trustLevel,
      permissions: {
        viewLocation: permissions.viewLocation !== undefined ? permissions.viewLocation : true,
        receiveAlerts: permissions.receiveAlerts !== undefined ? permissions.receiveAlerts : true,
        accessReports: permissions.accessReports !== undefined ? permissions.accessReports : false,
        emergencyContact: permissions.emergencyContact !== undefined ? permissions.emergencyContact : true
      },
      contactPreferences: {
        primaryMethod: contactPreferences.primaryMethod || 'all',
        quietHours: contactPreferences.quietHours || {},
        emergencyOnly: contactPreferences.emergencyOnly || false
      },
      syncSettings: {
        autoSync: syncSettings.autoSync !== undefined ? syncSettings.autoSync : true,
        syncFrequency: syncSettings.syncFrequency || 'realtime',
        lastSync: null,
        syncToken: null
      },
      checkInSettings: {
        frequency: checkInSettings.frequency || 'weekly',
        customDays: checkInSettings.customDays || [],
        customTime: checkInSettings.customTime || '18:00',
        reminderMethod: checkInSettings.reminderMethod || 'both'
      }
    });

    await guardianProfile.save();
    await guardianProfile.populate('guardian', 'name email profile.phone');

    res.status(201).json({
      message: 'Guardian added successfully',
      guardian: guardianProfile
    });
  } catch (error) {
    console.error('Add guardian error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's guardians
router.get('/', auth, async (req, res) => {
  try {
    const guardians = await Guardian.find({ user: req.user.id, isActive: true })
      .populate('guardian', 'name email profile.phone profile.avatar')
      .sort({ trustLevel: -1, createdAt: -1 });

    res.json(guardians);
  } catch (error) {
    console.error('Get guardians error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get guardians where user is a guardian
router.get('/where-guardian', auth, async (req, res) => {
  try {
    const guardians = await Guardian.find({ guardian: req.user.id, isActive: true })
      .populate('user', 'name email profile.phone profile.avatar')
      .sort({ trustLevel: -1, createdAt: -1 });

    res.json(guardians);
  } catch (error) {
    console.error('Get guardians where user is guardian error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update guardian profile
router.put('/:id', auth, [
  body('trustLevel').optional().isInt({ min: 1, max: 10 }).withMessage('Trust level must be between 1 and 10'),
  body('permissions.viewLocation').optional().isBoolean().withMessage('View location must be boolean'),
  body('permissions.receiveAlerts').optional().isBoolean().withMessage('Receive alerts must be boolean'),
  body('permissions.accessReports').optional().isBoolean().withMessage('Access reports must be boolean'),
  body('permissions.emergencyContact').optional().isBoolean().withMessage('Emergency contact must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this guardian' });
    }

    Object.assign(guardian, updates);
    await guardian.save();

    res.json({
      message: 'Guardian updated successfully',
      guardian
    });
  } catch (error) {
    console.error('Update guardian error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove guardian
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to remove this guardian' });
    }

    guardian.isActive = false;
    await guardian.save();

    res.json({ message: 'Guardian removed successfully' });
  } catch (error) {
    console.error('Remove guardian error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Set up affirmation lock
router.post('/:id/affirmation-lock', auth, [
  body('mantra').trim().isLength({ min: 5, max: 100 }).withMessage('Mantra must be between 5 and 100 characters'),
  body('hint').optional().trim().isLength({ max: 200 }).withMessage('Hint must be less than 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { mantra, hint } = req.body;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to set affirmation lock' });
    }

    guardian.affirmationLock = {
      isEnabled: true,
      mantra,
      hint,
      lastUsed: null,
      failedAttempts: 0
    };

    await guardian.save();

    res.json({
      message: 'Affirmation lock set successfully',
      hint: guardian.affirmationLock.hint
    });
  } catch (error) {
    console.error('Set affirmation lock error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify affirmation
router.post('/:id/verify-affirmation', auth, [
  body('mantra').trim().notEmpty().withMessage('Mantra is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { mantra } = req.body;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to verify affirmation' });
    }

    const isValid = await guardian.verifyAffirmation(mantra);

    if (isValid) {
      res.json({
        message: 'Affirmation verified successfully',
        accessGranted: true
      });
    } else {
      res.json({
        message: 'Invalid affirmation',
        accessGranted: false,
        failedAttempts: guardian.affirmationLock.failedAttempts
      });
    }
  } catch (error) {
    console.error('Verify affirmation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate sync token
router.post('/:id/sync-token', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to generate sync token' });
    }

    const syncToken = guardian.generateSyncToken();
    await guardian.save();

    res.json({
      message: 'Sync token generated successfully',
      syncToken,
      expiresIn: '24 hours'
    });
  } catch (error) {
    console.error('Generate sync token error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Validate sync token
router.post('/:id/validate-sync-token', auth, [
  body('token').trim().notEmpty().withMessage('Token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { token } = req.body;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to validate sync token' });
    }

    const isValid = guardian.validateSyncToken(token);

    if (isValid) {
      res.json({
        message: 'Sync token is valid',
        valid: true
      });
    } else {
      res.json({
        message: 'Invalid sync token',
        valid: false
      });
    }
  } catch (error) {
    console.error('Validate sync token error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create sync ritual
router.post('/:id/sync-ritual', auth, [
  body('type').isIn(['check_in', 'affirmation', 'sync', 'emergency_test']).withMessage('Invalid ritual type'),
  body('message').optional().trim().isLength({ max: 500 }).withMessage('Message must be less than 500 characters'),
  body('scheduledFor').optional().isISO8601().withMessage('Scheduled for must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { type, message, scheduledFor, metadata } = req.body;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to create sync ritual' });
    }

    const syncRitual = new SyncRitual({
      user: req.user.id,
      guardian: guardian.guardian,
      type,
      message,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      metadata
    });

    await syncRitual.save();

    res.status(201).json({
      message: 'Sync ritual created successfully',
      syncRitual
    });
  } catch (error) {
    console.error('Create sync ritual error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get sync rituals
router.get('/:id/sync-rituals', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status, type } = req.query;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view sync rituals' });
    }

    const query = { user: req.user.id, guardian: guardian.guardian };
    if (status) query.status = status;
    if (type) query.type = type;

    const syncRituals = await SyncRitual.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await SyncRitual.countDocuments(query);

    res.json({
      syncRituals,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get sync rituals error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete sync ritual
router.post('/sync-rituals/:ritualId/complete', auth, [
  body('response').optional().trim().isLength({ max: 500 }).withMessage('Response must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { ritualId } = req.params;
    const { response } = req.body;

    const syncRitual = await SyncRitual.findById(ritualId);
    
    if (!syncRitual) {
      return res.status(404).json({ message: 'Sync ritual not found' });
    }

    // Check if user is the guardian
    if (syncRitual.guardian.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to complete this ritual' });
    }

    syncRitual.status = 'completed';
    syncRitual.response = response;
    syncRitual.completedAt = new Date();
    syncRitual.calculateResponseTime();

    await syncRitual.save();

    // Update guardian response metrics
    const guardian = await Guardian.findOne({
      user: syncRitual.user,
      guardian: syncRitual.guardian
    });

    if (guardian) {
      await guardian.updateResponseMetrics(syncRitual.responseTime, true);
    }

    res.json({
      message: 'Sync ritual completed successfully',
      syncRitual
    });
  } catch (error) {
    console.error('Complete sync ritual error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get guardian statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const guardian = await Guardian.findById(id);
    
    if (!guardian) {
      return res.status(404).json({ message: 'Guardian not found' });
    }

    // Check if user owns this guardian relationship
    if (guardian.user.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to view guardian stats' });
    }

    const syncRituals = await SyncRitual.find({
      user: req.user.id,
      guardian: guardian.guardian
    });

    const stats = {
      totalRituals: syncRituals.length,
      completedRituals: syncRituals.filter(r => r.status === 'completed').length,
      pendingRituals: syncRituals.filter(r => r.status === 'pending').length,
      averageResponseTime: guardian.averageResponseTime || 0,
      responseRate: guardian.responseRate || 0,
      lastInteraction: guardian.lastInteraction,
      interactionCount: guardian.interactionCount
    };

    res.json(stats);
  } catch (error) {
    console.error('Get guardian stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
