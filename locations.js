// src/routes/locations.js
const express   = require('express');
const Joi       = require('joi');
const db        = require('../config/db');
const { authenticateUser, authenticateDevice } = require('../middleware/auth');
const {
  reverseGeocode,
  getCellTowerLocation,
  getLocationFromIP,
  isInsideGeofence
} = require('../config/integrations');
const router    = express.Router();

// ─── POST /api/locations/report ──────────────────────────
// Called by the mobile agent app to push a location ping.
// Auth: x-device-api-key header
router.post('/report', authenticateDevice, async (req, res, next) => {
  try {
    const schema = Joi.object({
      latitude:  Joi.number().min(-90).max(90),
      longitude: Joi.number().min(-180).max(180),
      altitude:  Joi.number().optional(),
      accuracy:  Joi.number().optional(),
      speed:     Joi.number().optional(),
      heading:   Joi.number().optional(),
      source:    Joi.string().valid('gps', 'cell_tower', 'ip').default('gps'),
      // Cell tower data (when source=cell_tower)
      cell_info: Joi.object({
        mcc:       Joi.number(),
        mnc:       Joi.number(),
        lac:       Joi.number(),
        cellId:    Joi.number(),
        radioType: Joi.string().optional()
      }).optional(),
      recorded_at: Joi.string().isoDate().optional()
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    let { latitude, longitude, source, cell_info } = value;

    // ── If no GPS coords, try cell tower lookup ─────────
    if ((!latitude || !longitude) && source === 'cell_tower' && cell_info) {
      const cellLoc = await getCellTowerLocation(cell_info);
      if (cellLoc) {
        latitude  = cellLoc.latitude;
        longitude = cellLoc.longitude;
        value.accuracy = cellLoc.accuracy;
      }
    }

    // ── Fallback: IP geolocation ─────────────────────────
    if (!latitude || !longitude) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
      const ipLoc = await getLocationFromIP(ip);
      if (ipLoc) {
        latitude  = ipLoc.latitude;
        longitude = ipLoc.longitude;
        value.accuracy = ipLoc.accuracy;
        source = 'ip';
      }
    }

    if (!latitude || !longitude) {
      return res.status(422).json({ error: 'Could not determine location' });
    }

    // ── Reverse geocode to address ───────────────────────
    const geo = await reverseGeocode(latitude, longitude);

    const result = await db.query(
      `INSERT INTO locations
         (device_id, latitude, longitude, altitude, accuracy, speed,
          heading, source, cell_info, address, city, country, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        req.device.id, latitude, longitude,
        value.altitude || null, value.accuracy || null,
        value.speed || null, value.heading || null,
        source, cell_info ? JSON.stringify(cell_info) : null,
        geo.address, geo.city, geo.country,
        value.recorded_at || new Date().toISOString()
      ]
    );

    const location = result.rows[0];

    // ── Geofence check ───────────────────────────────────
    await checkGeofences(req.device.id, location);

    res.status(201).json({ location });
  } catch (err) { next(err); }
});

// ─── GET /api/locations/:deviceId ────────────────────────
// Get location history for a device (requires user JWT)
router.get('/:deviceId', authenticateUser, async (req, res, next) => {
  try {
    // Verify device belongs to user
    const deviceCheck = await db.query(
      'SELECT id FROM devices WHERE id=$1 AND user_id=$2',
      [req.params.deviceId, req.user.id]
    );
    if (!deviceCheck.rows.length) return res.status(404).json({ error: 'Device not found' });

    const limit  = parseInt(req.query.limit)  || 100;
    const offset = parseInt(req.query.offset) || 0;
    const from   = req.query.from;   // ISO date string
    const to     = req.query.to;     // ISO date string

    let query = `SELECT * FROM locations WHERE device_id=$1`;
    const params = [req.params.deviceId];
    let paramIdx = 2;

    if (from) { query += ` AND recorded_at >= $${paramIdx++}`; params.push(from); }
    if (to)   { query += ` AND recorded_at <= $${paramIdx++}`; params.push(to); }

    query += ` ORDER BY recorded_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    res.json({ locations: result.rows, count: result.rows.length });
  } catch (err) { next(err); }
});

// ─── GET /api/locations/:deviceId/latest ─────────────────
router.get('/:deviceId/latest', authenticateUser, async (req, res, next) => {
  try {
    const deviceCheck = await db.query(
      'SELECT id FROM devices WHERE id=$1 AND user_id=$2',
      [req.params.deviceId, req.user.id]
    );
    if (!deviceCheck.rows.length) return res.status(404).json({ error: 'Device not found' });

    const result = await db.query(
      `SELECT * FROM locations WHERE device_id=$1 ORDER BY recorded_at DESC LIMIT 1`,
      [req.params.deviceId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No location data yet' });
    res.json({ location: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── Geofence Alert Logic ─────────────────────────────────
async function checkGeofences(deviceId, location) {
  try {
    const fences = await db.query(
      'SELECT * FROM geofences WHERE device_id=$1 AND is_active=true',
      [deviceId]
    );
    for (const fence of fences.rows) {
      const inside = isInsideGeofence(
        parseFloat(location.latitude), parseFloat(location.longitude), fence
      );
      // Simple alert creation — extend with email/push notifications
      if (inside && fence.alert_enter) {
        await db.query(
          `INSERT INTO alerts (device_id, geofence_id, type, message, location_id)
           VALUES ($1,$2,'geofence_enter',$3,$4)
           ON CONFLICT DO NOTHING`,
          [deviceId, fence.id, `Device entered geofence: ${fence.name}`, location.id]
        );
      }
    }
  } catch (err) {
    console.error('[Geofence Check] Error:', err.message);
  }
}

module.exports = router;
