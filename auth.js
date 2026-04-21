// src/routes/auth.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const Joi      = require('joi');
const db       = require('../config/db');
const router   = express.Router();

const registerSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  name:     Joi.string().max(100).optional()
});

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const exists = await db.query('SELECT id FROM users WHERE email = $1', [value.email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(value.password, 12);
    const result = await db.query(
      `INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name, role`,
      [value.email, hash, value.name || null]
    );
    const user  = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.status(201).json({ user, token });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    const user   = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser, token });
  } catch (err) { next(err); }
});

module.exports = router;
