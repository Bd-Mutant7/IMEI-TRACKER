// src/routes/geofences.js
const express = require('express');
const Joi     = require('joi');
const db      = require('../config/db');
const { authenticateUser } = require('../middleware/auth');
const router  = express.Router();

router.use(authenticateUser);

const schema = Joi.object({
  device_id:    Joi.string().uuid().required(),
  name:         Joi.string().max(255).required(),
  lat_center:   Joi.number().min(-90).max(90).required(),
  lng_center:   Joi.number().min(-180).max(180).required(),
  radius_m:     Joi.number().min(50).max(100000).required(),
  alert_enter:  Joi.boolean().default(true),
  alert_exit:   Joi.boolean().default(true)
});

// GET /api/geofences?device_id=...
router.get('/', async (req, res, next) => {
  try {
    const { device_id } = req.query;
    const result = await db.query(
      `SELECT g.* FROM geofences g
       JOIN devices d ON g.device_id = d.id
       WHERE d.user_id=$1 ${device_id ? 'AND g.device_id=$2' : ''}
       ORDER BY g.created_at DESC`,
      device_id ? [req.user.id, device_id] : [req.user.id]
    );
    res.json({ geofences: result.rows });
  } catch (err) { next(err); }
});

// POST /api/geofences
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const devCheck = await db.query(
      'SELECT id FROM devices WHERE id=$1 AND user_id=$2',
      [value.device_id, req.user.id]
    );
    if (!devCheck.rows.length) return res.status(404).json({ error: 'Device not found' });

    const result = await db.query(
      `INSERT INTO geofences (device_id, name, lat_center, lng_center, radius_m, alert_enter, alert_exit)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [value.device_id, value.name, value.lat_center, value.lng_center,
       value.radius_m, value.alert_enter, value.alert_exit]
    );
    res.status(201).json({ geofence: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/geofences/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM geofences g USING devices d
       WHERE g.id=$1 AND g.device_id=d.id AND d.user_id=$2 RETURNING g.id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Geofence not found' });
    res.json({ message: 'Geofence deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
