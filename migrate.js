// src/config/migrate.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Running migrations...');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    `);

    // Users table (API owners / admin accounts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email       VARCHAR(255) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        name        VARCHAR(255),
        role        VARCHAR(50) DEFAULT 'user',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Devices table (registered IMEIs)
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
        imei          VARCHAR(20) UNIQUE NOT NULL,
        device_name   VARCHAR(255),
        brand         VARCHAR(100),
        model         VARCHAR(100),
        os_type       VARCHAR(50),        -- android | ios | other
        phone_number  VARCHAR(30),
        carrier       VARCHAR(100),
        is_active     BOOLEAN DEFAULT true,
        api_key       VARCHAR(64) UNIQUE, -- device reports location using this key
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Locations table (historical location pings)
    await client.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        device_id     UUID REFERENCES devices(id) ON DELETE CASCADE,
        latitude      DECIMAL(10, 8) NOT NULL,
        longitude     DECIMAL(11, 8) NOT NULL,
        altitude      DECIMAL(10, 2),
        accuracy      DECIMAL(10, 2),     -- meters
        speed         DECIMAL(10, 2),     -- km/h
        heading       DECIMAL(5, 2),      -- degrees
        source        VARCHAR(50) DEFAULT 'gps',  -- gps | cell_tower | ip
        cell_info     JSONB,              -- raw cell tower data if source=cell_tower
        address       TEXT,              -- reverse-geocoded address
        city          VARCHAR(100),
        country       VARCHAR(100),
        recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Index for fast device location queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_locations_device_id ON locations(device_id);
      CREATE INDEX IF NOT EXISTS idx_locations_recorded_at ON locations(recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_devices_imei ON devices(imei);
      CREATE INDEX IF NOT EXISTS idx_devices_api_key ON devices(api_key);
    `);

    // Geofences table (alert zones)
    await client.query(`
      CREATE TABLE IF NOT EXISTS geofences (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        device_id   UUID REFERENCES devices(id) ON DELETE CASCADE,
        name        VARCHAR(255) NOT NULL,
        lat_center  DECIMAL(10, 8) NOT NULL,
        lng_center  DECIMAL(11, 8) NOT NULL,
        radius_m    INTEGER NOT NULL,        -- radius in meters
        alert_enter BOOLEAN DEFAULT true,
        alert_exit  BOOLEAN DEFAULT true,
        is_active   BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Alerts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        device_id   UUID REFERENCES devices(id) ON DELETE CASCADE,
        geofence_id UUID REFERENCES geofences(id) ON DELETE SET NULL,
        type        VARCHAR(50),           -- geofence_enter | geofence_exit | offline
        message     TEXT,
        location_id UUID REFERENCES locations(id),
        is_read     BOOLEAN DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('✅ Migrations complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
