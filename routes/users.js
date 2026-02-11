const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile
router.put('/profile', auth, [
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('profile.phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('profile.bio').optional().trim().isLength({ max: 500 }).withMessage('Bio must be less than 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add emergency contact
router.post('/emergency-contacts', auth, [
  body('name').trim().notEmpty().withMessage('Contact name is required'),
  body('phone').isMobilePhone().withMessage('Please provide a valid phone number'),
  body('relationship').notEmpty().withMessage('Relationship is required'),
  body('priority').optional().isInt({ min: 1, max: 5 }).withMessage('Priority must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, phone, relationship, priority = 1 } = req.body;
    
    const user = await User.findById(req.user.id);
    user.profile.emergencyContacts.push({
      name,
      phone,
      relationship,
      priority
    });

    await user.save();

    res.json({
      message: 'Emergency contact added successfully',
      contact: user.profile.emergencyContacts[user.profile.emergencyContacts.length - 1]
    });
  } catch (error) {
    console.error('Add emergency contact error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update emergency contact
router.put('/emergency-contacts/:contactId', auth, [
  body('name').optional().trim().notEmpty().withMessage('Contact name cannot be empty'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('relationship').optional().notEmpty().withMessage('Relationship cannot be empty'),
  body('priority').optional().isInt({ min: 1, max: 5 }).withMessage('Priority must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contactId } = req.params;
    const updates = req.body;
    
    const user = await User.findById(req.user.id);
    const contact = user.profile.emergencyContacts.id(contactId);
    
    if (!contact) {
      return res.status(404).json({ message: 'Emergency contact not found' });
    }

    Object.assign(contact, updates);
    await user.save();

    res.json({
      message: 'Emergency contact updated successfully',
      contact
    });
  } catch (error) {
    console.error('Update emergency contact error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete emergency contact
router.delete('/emergency-contacts/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;
    
    const user = await User.findById(req.user.id);
    const contact = user.profile.emergencyContacts.id(contactId);
    
    if (!contact) {
      return res.status(404).json({ message: 'Emergency contact not found' });
    }

    contact.remove();
    await user.save();

    res.json({ message: 'Emergency contact deleted successfully' });
  } catch (error) {
    console.error('Delete emergency contact error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update safety preferences
router.put('/safety-preferences', auth, [
  body('shareLocation').optional().isBoolean().withMessage('Share location must be boolean'),
  body('autoAlertThreshold').optional().isInt({ min: 5, max: 120 }).withMessage('Auto alert threshold must be between 5 and 120 minutes'),
  body('preferredContactMethod').optional().isIn(['sms', 'email', 'both']).withMessage('Invalid contact method')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const updates = req.body;
    const user = await User.findById(req.user.id);
    
    Object.assign(user.profile.safetyPreferences, updates);
    await user.save();

    res.json({
      message: 'Safety preferences updated successfully',
      preferences: user.profile.safetyPreferences
    });
  } catch (error) {
    console.error('Update safety preferences error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update location
router.put('/location', auth, [
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of 2 numbers'),
  body('address').optional().trim().notEmpty().withMessage('Address cannot be empty'),
  body('isShared').optional().isBoolean().withMessage('Is shared must be boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { coordinates, address, isShared } = req.body;
    
    const user = await User.findById(req.user.id);
    user.profile.location = {
      type: 'Point',
      coordinates
    };
    
    if (address) {
      user.profile.location.address = address;
    }
    
    if (isShared !== undefined) {
      user.profile.isLocationShared = isShared;
    }

    await user.save();

    res.json({
      message: 'Location updated successfully',
      location: user.profile.location,
      isShared: user.profile.isLocationShared
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's safety streak
router.get('/safety-streak', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json({
      currentStreak: user.safetyStreak.current,
      longestStreak: user.safetyStreak.longest,
      lastCheckIn: user.safetyStreak.lastCheckIn,
      badges: user.badges
    });
  } catch (error) {
    console.error('Get safety streak error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's whisper chain
router.get('/whisper-chain', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('whisperChain.contactId', 'name email profile.phone');
    res.json(user.whisperChain);
  } catch (error) {
    console.error('Get whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add to whisper chain
router.post('/whisper-chain', auth, [
  body('contactId').isMongoId().withMessage('Valid contact ID is required'),
  body('priority').optional().isInt({ min: 1, max: 10 }).withMessage('Priority must be between 1 and 10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contactId, priority = 1 } = req.body;
    
    // Check if contact exists
    const contact = await User.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const user = await User.findById(req.user.id);
    await user.addToWhisperChain(contactId, priority);

    res.json({
      message: 'Contact added to whisper chain successfully',
      contact: {
        contactId,
        priority,
        name: contact.name
      }
    });
  } catch (error) {
    console.error('Add to whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update whisper chain priority
router.put('/whisper-chain/:contactId', auth, [
  body('priority').isInt({ min: 1, max: 10 }).withMessage('Priority must be between 1 and 10')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contactId } = req.params;
    const { priority } = req.body;
    
    const user = await User.findById(req.user.id);
    const contact = user.whisperChain.find(c => c.contactId.toString() === contactId);
    
    if (!contact) {
      return res.status(404).json({ message: 'Contact not found in whisper chain' });
    }

    contact.priority = priority;
    await user.save();

    res.json({
      message: 'Whisper chain priority updated successfully',
      contact
    });
  } catch (error) {
    console.error('Update whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove from whisper chain
router.delete('/whisper-chain/:contactId', auth, async (req, res) => {
  try {
    const { contactId } = req.params;
    
    const user = await User.findById(req.user.id);
    user.whisperChain = user.whisperChain.filter(c => c.contactId.toString() !== contactId);
    await user.save();

    res.json({ message: 'Contact removed from whisper chain successfully' });
  } catch (error) {
    console.error('Remove from whisper chain error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get nearby users (for community features)
router.get('/nearby', auth, [
  body('radius').optional().isInt({ min: 100, max: 10000 }).withMessage('Radius must be between 100 and 10000 meters')
], async (req, res) => {
  try {
    const { radius = 1000 } = req.query;
    const user = await User.findById(req.user.id);
    
    if (!user.profile.location.coordinates) {
      return res.status(400).json({ message: 'User location not set' });
    }

    const nearbyUsers = await User.find({
      _id: { $ne: user._id },
      'profile.location': {
        $near: {
          $geometry: user.profile.location,
          $maxDistance: radius
        }
      },
      'profile.isLocationShared': true
    }).select('name profile.avatar profile.location lastActive');

    res.json(nearbyUsers);
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
