// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db  = require('../config/db');

// ─── JWT Auth (for dashboard users) ──────────────────────
const authenticateUser = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ─── Device API Key Auth (for mobile agents reporting location) ──
const authenticateDevice = async (req, res, next) => {
  const apiKey = req.headers['x-device-api-key'] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-device-api-key header' });
  }
  try {
    const result = await db.query(
      'SELECT * FROM devices WHERE api_key = $1 AND is_active = true',
      [apiKey]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.device = result.rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

// ─── Admin only ───────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { authenticateUser, authenticateDevice, requireAdmin };
