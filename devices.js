// src/routes/devices.js
const express   = require('express');
const crypto    = require('crypto');
const Joi       = require('joi');
const db        = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const { lookupPhoneNumber, twilioLookup } = require('../config/integrations');
const router    = express.Router();

// All device routes require a logged-in user
router.use(authenticateUser);

const deviceSchema = Joi.object({
  imei:         Joi.string().pattern(/^\d{15}$/).required(),
  device_name:  Joi.string().max(255).optional(),
  brand:        Joi.string().max(100).optional(),
  model:        Joi.string().max(100).optional(),
  os_type:      Joi.string().valid('android', 'ios', 'other').optional(),
  phone_number: Joi.string().max(30).optional()
});

// ─── GET /api/devices ─────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT d.*, 
        (SELECT row_to_json(l) FROM (
          SELECT latitude, longitude, address, recorded_at
          FROM locations WHERE device_id = d.id
          ORDER BY recorded_at DESC LIMIT 1
        ) l) AS last_location
      FROM devices d WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
      [req.user.id]
    );
    res.json({ devices: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/devices ────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = deviceSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    // Validate IMEI check digit (Luhn algorithm)
    if (!validateIMEI(value.imei)) {
      return res.status(400).json({ error: 'Invalid IMEI — check digit failed' });
    }

    const apiKey = crypto.randomBytes(32).toString('hex');

    // Try to enrich with carrier info if phone number provided
    let carrier = null;
    if (value.phone_number) {
      const numInfo = await lookupPhoneNumber(value.phone_number);
      if (numInfo) carrier = numInfo.carrier;
    }

    const result = await db.query(
      `INSERT INTO devices (user_id, imei, device_name, brand, model, os_type, phone_number, carrier, api_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.id, value.imei, value.device_name, value.brand,
       value.model, value.os_type, value.phone_number, carrier, apiKey]
    );

    res.status(201).json({ device: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'IMEI already registered' });
    next(err);
  }
});

// ─── GET /api/devices/:id ────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM devices WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ device: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── PATCH /api/devices/:id ──────────────────────────────
router.patch('/:id', async (req, res, next) => {
  try {
    const { device_name, is_active } = req.body;
    const result = await db.query(
      `UPDATE devices SET device_name=$1, is_active=$2, updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING *`,
      [device_name, is_active, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ device: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── DELETE /api/devices/:id ─────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM devices WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ message: 'Device deleted' });
  } catch (err) { next(err); }
});

// ─── POST /api/devices/:id/regenerate-key ────────────────
router.post('/:id/regenerate-key', async (req, res, next) => {
  try {
    const apiKey = crypto.randomBytes(32).toString('hex');
    const result = await db.query(
      `UPDATE devices SET api_key=$1, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 RETURNING api_key`,
      [apiKey, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Device not found' });
    res.json({ api_key: result.rows[0].api_key });
  } catch (err) { next(err); }
});

// ─── IMEI Luhn Validator ─────────────────────────────────
function validateIMEI(imei) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = parseInt(imei[i]);
    if (i % 2 !== 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

module.exports = router;
