// src/index.js
require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const deviceRoutes    = require('./routes/devices');
const locationRoutes  = require('./routes/locations');
const geofenceRoutes  = require('./routes/geofences');

const app = express();

// ─── Security ─────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET','POST','PATCH','DELETE']
}));

// ─── Rate limiting ────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please slow down' }
}));
// Stricter limit for location reporting (device pings)
app.use('/api/locations/report', rateLimit({
  windowMs: 60 * 1000,
  max: 60  // 1 ping per second max per IP
}));

// ─── Middleware ───────────────────────────────────────────
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/devices',    deviceRoutes);
app.use('/api/locations',  locationRoutes);
app.use('/api/geofences',  geofenceRoutes);

// ─── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Docs (inline) ────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'IMEI Tracker API',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Create account',
        'POST /api/auth/login':    'Login → get JWT'
      },
      devices: {
        'GET  /api/devices':                      'List your devices',
        'POST /api/devices':                      'Register a new IMEI',
        'GET  /api/devices/:id':                  'Get device details',
        'PATCH /api/devices/:id':                 'Update device',
        'DELETE /api/devices/:id':                'Remove device',
        'POST /api/devices/:id/regenerate-key':   'New API key for device'
      },
      locations: {
        'POST /api/locations/report':             'Push a location (device auth)',
        'GET  /api/locations/:deviceId':          'Get location history',
        'GET  /api/locations/:deviceId/latest':   'Get latest location'
      },
      geofences: {
        'GET  /api/geofences':    'List geofences',
        'POST /api/geofences':    'Create geofence',
        'DELETE /api/geofences/:id': 'Delete geofence'
      }
    }
  });
});

// ─── Error handler ────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🛰  IMEI Tracker API running on port ${PORT}`);
  console.log(`📖  Docs: http://localhost:${PORT}`);
  console.log(`💊  Health: http://localhost:${PORT}/health\n`);
});
