

# 🛰 IMEI Tracker — Complete Setup & API Integration Guide

[![Support](https://img.shields.io/badge/Support-Paystack-00C3F7?style=for-the-badge&logo=paypal&logoColor=white)](https://paystack.shop/pay/bd-mutant7)


![IMEI Tracker](IMEI-TRACKER.png)



---

## 🚀 Quick Start

### Option A — Docker (recommended)

```bash
cd imei-tracker

# 1. Copy env file and fill in your keys
cp backend/.env.example backend/.env

# 2. Start everything
docker-compose up -d

# The API is now at http://localhost:3000
# pgAdmin is at http://localhost:5050 (admin@tracker.local / admin)
```

### Option B — Manual

```bash
# 1. Install PostgreSQL and create DB
createdb imei_tracker

# 2. Install backend
cd backend
npm install
cp .env.example .env
# Edit .env with your DB creds and API keys

# 3. Run migrations
npm run migrate

# 4. Start API
npm run dev

# 5. Open frontend
open frontend/index.html
```

---

## 🔌 API Integration Guide

### 1. Google Maps Platform (Reverse Geocoding + Map Display)

**What it does:** Converts latitude/longitude → readable address. Also powers the map tiles in the dashboard.

**Setup:**
1. Go to https://console.cloud.google.com
2. Create a project → **APIs & Services** → **Enable APIs**
3. Enable: **Maps JavaScript API** and **Geocoding API**
4. Go to **Credentials** → **Create API Key**
5. (Recommended) Restrict the key to your domain and only those two APIs

**Cost:** Free tier includes $200/month credit (~40,000 geocoding calls free)

**Add to .env:**
```
GOOGLE_MAPS_API_KEY=AIza...
```

**Add to frontend dashboard** (replace map tiles):
```html
<!-- In index.html, replace the Carto tile layer with: -->
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_KEY"></script>
```

---

### 2. OpenCelliD / UnwiredLabs (Cell Tower Geolocation)

**What it does:** Given cell tower ID (MCC, MNC, LAC, CellID), returns the lat/lng of that tower. Useful when GPS is unavailable.

**Setup:**
1. Register at https://opencellid.org/register.php (free)
2. For the API endpoint (UnwiredLabs): https://unwiredlabs.com/api#documentation
3. Free tier: 100 requests/day

**Add to .env:**
```
OPENCELLID_API_KEY=your_key
```

**Your mobile app sends:**
```json
{
  "source": "cell_tower",
  "cell_info": {
    "mcc": 226,
    "mnc": 10,
    "lac": 1234,
    "cellId": 56789,
    "radioType": "gsm"
  }
}
```

---

### 3. NUMVERIFY (Phone Number + Carrier Validation)

**What it does:** Validates phone number format and returns carrier name, line type, and country — used when registering a device with a phone number.

**Setup:**
1. Sign up at https://numverify.com (free 250 requests/month)
2. Get API key from dashboard

**Add to .env:**
```
NUMVERIFY_API_KEY=your_key
```

**Triggered automatically** when you register a device with a phone number.

---

### 4. Twilio Lookup (Carrier Info — Paid)

**What it does:** More reliable carrier lookup than NUMVERIFY. Also supports SIM swap detection.

**Setup:**
1. Sign up at https://www.twilio.com/try-twilio
2. Get Account SID and Auth Token from Console
3. ~$0.005 per lookup

**Add to .env:**
```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
```

---

### 5. Abstract API (IP Geolocation Fallback)

**What it does:** When no GPS or cell tower data is available, falls back to IP-based geolocation. City-level accuracy.

**Setup:**
1. Sign up at https://www.abstractapi.com
2. Choose **IP Geolocation API** — free 20,000 calls/month

**Add to .env:**
```
ABSTRACT_IP_GEO_KEY=your_key
```

---

## 📡 API Endpoints Reference

### Authentication
```
POST /api/auth/register    Body: { email, password, name }
POST /api/auth/login       Body: { email, password }
                           Returns: { user, token }
```

### Devices (requires Bearer token)
```
GET    /api/devices
POST   /api/devices         Body: { imei, device_name, brand, model, os_type, phone_number }
GET    /api/devices/:id
PATCH  /api/devices/:id
DELETE /api/devices/:id
POST   /api/devices/:id/regenerate-key
```

### Location Reporting (requires x-device-api-key header)
```
POST /api/locations/report
Body: {
  latitude, longitude,        ← GPS coordinates
  altitude, accuracy,         ← optional
  speed, heading,             ← optional
  source: "gps"|"cell_tower"|"ip",
  cell_info: { mcc, mnc, lac, cellId }  ← if source=cell_tower
}
```

### Location Queries (requires Bearer token)
```
GET /api/locations/:deviceId?limit=100&from=2024-01-01&to=2024-12-31
GET /api/locations/:deviceId/latest
```

### Geofences (requires Bearer token)
```
GET    /api/geofences?device_id=xxx
POST   /api/geofences    Body: { device_id, name, lat_center, lng_center, radius_m }
DELETE /api/geofences/:id
```

---

## 📱 Mobile Agent Setup

1. Copy `mobile-agent/LocationReporterService.kt` into your Android Studio project
2. Set `API_BASE` and `DEVICE_KEY` at the top of the file
   - `DEVICE_KEY` is the API key shown in the dashboard after registering the device
3. Add permissions to `AndroidManifest.xml` (see comment at top of file)
4. Start the service from your MainActivity

---

## ⚖️ Legal Compliance

- All devices must belong to users who have given **explicit consent** to be tracked
- In the EU/Romania, this is governed by **GDPR** — you need a lawful basis
- Add a consent screen to your mobile app before starting the service
- Store a `consent_given_at` timestamp per device
- Provide a way for users to request data deletion

---

## 🔒 Security Checklist

- [ ] Change `JWT_SECRET` to a random 64-char string in production
- [ ] Use HTTPS in production (add nginx/certbot or Cloudflare)
- [ ] Restrict Google Maps API key to your domain
- [ ] Rotate device API keys periodically
- [ ] Enable PostgreSQL SSL in production
- [ ] Set `ALLOWED_ORIGINS` in .env to your frontend domain
