const express = require('express');
const router = express.Router();
const SettingsController = require('../controllers/SettingsController');

router.get('/discord-webhooks', SettingsController.getWebhooks);
router.post('/discord-webhook', SettingsController.saveWebhook);
router.put('/discord-webhook/:id', SettingsController.updateWebhook);
router.delete('/discord-webhook/:id', SettingsController.deleteWebhook);

module.exports = router; 