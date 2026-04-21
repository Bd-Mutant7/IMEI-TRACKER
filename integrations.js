// src/config/integrations.js
// ─────────────────────────────────────────────────────────────
// All external API calls in one place.
// Replace the placeholder keys in your .env file.
// ─────────────────────────────────────────────────────────────
const axios = require('axios');

// ─── 1. Google Maps — Reverse Geocoding ──────────────────
// Converts lat/lng → human-readable address
// Docs: https://developers.google.com/maps/documentation/geocoding
async function reverseGeocode(lat, lng) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || key === 'your_google_maps_key') {
    return { address: null, city: null, country: null };
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json`;
    const { data } = await axios.get(url, {
      params: { latlng: `${lat},${lng}`, key }
    });
    if (data.status !== 'OK') return { address: null, city: null, country: null };

    const result  = data.results[0];
    const address = result.formatted_address;
    const comps   = result.address_components;
    const city    = comps.find(c => c.types.includes('locality'))?.long_name || null;
    const country = comps.find(c => c.types.includes('country'))?.long_name || null;
    return { address, city, country };
  } catch (err) {
    console.error('[Google Geocode] Error:', err.message);
    return { address: null, city: null, country: null };
  }
}

// ─── 2. OpenCelliD — Cell Tower Geolocation ──────────────
// Given a cell tower ID, returns lat/lng
// Free tier: unlimited lookups with registration
// Docs: https://opencellid.org/api
async function getCellTowerLocation({ mcc, mnc, lac, cellId, radioType = 'gsm' }) {
  const key = process.env.OPENCELLID_API_KEY;
  if (!key || key === 'your_opencellid_key') {
    return null;
  }
  try {
    const url = 'https://us1.unwiredlabs.com/v2/process.php';
    const body = {
      token: key,
      radio: radioType,
      mcc, mnc,
      cells: [{ lac, cid: cellId }],
      address: 0
    };
    const { data } = await axios.post(url, body);
    if (data.status !== 'ok') return null;
    return { latitude: data.lat, longitude: data.lon, accuracy: data.accuracy };
  } catch (err) {
    console.error('[OpenCelliD] Error:', err.message);
    return null;
  }
}

// ─── 3. Abstract API — IP Geolocation (fallback) ─────────
// Docs: https://www.abstractapi.com/api/ip-geolocation-api
async function getLocationFromIP(ip) {
  const key = process.env.ABSTRACT_IP_GEO_KEY;
  if (!key || key === 'your_abstract_api_key') return null;
  try {
    const { data } = await axios.get('https://ipgeolocation.abstractapi.com/v1/', {
      params: { api_key: key, ip_address: ip }
    });
    if (!data.latitude) return null;
    return {
      latitude:  parseFloat(data.latitude),
      longitude: parseFloat(data.longitude),
      city:      data.city,
      country:   data.country,
      accuracy:  50000   // IP geo is very rough
    };
  } catch (err) {
    console.error('[AbstractAPI IP Geo] Error:', err.message);
    return null;
  }
}

// ─── 4. NUMVERIFY — IMEI / Phone Validation ──────────────
// Validates IMEI format and gets carrier info from phone number
// Free: 250 req/month | Docs: https://numverify.com/documentation
async function lookupPhoneNumber(phoneNumber) {
  const key = process.env.NUMVERIFY_API_KEY;
  if (!key || key === 'your_numverify_key') return null;
  try {
    const { data } = await axios.get('https://apilayer.net/api/validate', {
      params: { access_key: key, number: phoneNumber, format: 1 }
    });
    if (!data.valid) return null;
    return {
      valid:        data.valid,
      carrier:      data.carrier,
      line_type:    data.line_type,
      country_name: data.country_name,
      location:     data.location
    };
  } catch (err) {
    console.error('[NUMVERIFY] Error:', err.message);
    return null;
  }
}

// ─── 5. Twilio Lookup — Carrier Info ─────────────────────
// Paid per lookup — returns carrier and line type for a number
// Docs: https://www.twilio.com/docs/lookup/v2-api
async function twilioLookup(phoneNumber) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || sid === 'your_twilio_sid') return null;
  try {
    const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}`;
    const { data } = await axios.get(url, {
      auth: { username: sid, password: token },
      params: { Fields: 'line_type_intelligence,sim_swap' }
    });
    return {
      valid:      data.valid,
      carrier:    data.line_type_intelligence?.carrier_name,
      line_type:  data.line_type_intelligence?.type,
      mobile:     data.line_type_intelligence?.mobile_country_code != null
    };
  } catch (err) {
    console.error('[Twilio Lookup] Error:', err.message);
    return null;
  }
}

// ─── Geofence Check ──────────────────────────────────────
// Returns distance between two lat/lng points in meters (Haversine)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isInsideGeofence(lat, lng, fence) {
  return haversineDistance(lat, lng, fence.lat_center, fence.lng_center) <= fence.radius_m;
}

module.exports = {
  reverseGeocode,
  getCellTowerLocation,
  getLocationFromIP,
  lookupPhoneNumber,
  twilioLookup,
  haversineDistance,
  isInsideGeofence
};
