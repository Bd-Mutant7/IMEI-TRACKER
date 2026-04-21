// ─────────────────────────────────────────────────────────────
// Android Mobile Agent — LocationReporterService.kt
// Paste this into your Android Studio project.
// 
// Permissions needed in AndroidManifest.xml:
//   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
//   <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>
//   <uses-permission android:name="android.permission.READ_PHONE_STATE"/>
//   <uses-permission android:name="android.permission.INTERNET"/>
//   <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
// ─────────────────────────────────────────────────────────────

package com.yourapp.imeitracker

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.os.IBinder
import android.os.Looper
import android.telephony.TelephonyManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class LocationReporterService : Service() {

    // ── CONFIGURE THESE ──────────────────────────────────────
    private val API_BASE    = "https://your-api.com/api"  // Your deployed API URL
    private val DEVICE_KEY  = "your_device_api_key_here"  // From the dashboard after registering
    private val INTERVAL_MS = 30_000L                      // Report every 30 seconds
    // ─────────────────────────────────────────────────────────

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        startForeground(1, buildNotification())
        startLocationUpdates()
    }

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(INTERVAL_MS / 2)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { reportLocation(it) }
            }
        }

        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED) {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        }
    }

    private fun reportLocation(location: Location) {
        // Build payload
        val payload = JSONObject().apply {
            put("latitude",  location.latitude)
            put("longitude", location.longitude)
            put("altitude",  location.altitude)
            put("accuracy",  location.accuracy)
            put("speed",     if (location.hasSpeed()) location.speed * 3.6 else JSONObject.NULL) // m/s → km/h
            put("heading",   if (location.hasBearing()) location.bearing else JSONObject.NULL)
            put("source",    "gps")
            put("recorded_at", java.time.Instant.ofEpochMilli(location.time).toString())

            // Optional: add cell tower info
            getCellInfo()?.let { put("cell_info", it) }
        }

        // Fire-and-forget in background thread
        Thread {
            try {
                val url = URL("$API_BASE/locations/report")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("x-device-api-key", DEVICE_KEY)
                conn.doOutput = true
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000

                OutputStreamWriter(conn.outputStream).use { it.write(payload.toString()) }

                val code = conn.responseCode
                android.util.Log.d("IMEI_TRACKER", "Location reported: HTTP $code")
                conn.disconnect()
            } catch (e: Exception) {
                android.util.Log.e("IMEI_TRACKER", "Failed to report: ${e.message}")
            }
        }.start()
    }

    private fun getCellInfo(): JSONObject? {
        return try {
            val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            if (ActivityCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE)
                != PackageManager.PERMISSION_GRANTED) return null

            // Get MCC/MNC from network operator
            val operator = tm.networkOperator
            if (operator.isNullOrEmpty() || operator.length < 5) return null

            JSONObject().apply {
                put("mcc", operator.substring(0, 3).toIntOrNull())
                put("mnc", operator.substring(3).toIntOrNull())
                // For LAC/CellID you'd need getAllCellInfo() — requires API 17+
                put("radioType", when(tm.networkType) {
                    TelephonyManager.NETWORK_TYPE_LTE  -> "lte"
                    TelephonyManager.NETWORK_TYPE_UMTS -> "umts"
                    else -> "gsm"
                })
            }
        } catch (e: Exception) { null }
    }

    private fun buildNotification(): Notification {
        val channelId = "location_tracker"
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Location Tracker", NotificationManager.IMPORTANCE_LOW)
            )
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("IMEI Tracker Active")
            .setContentText("Reporting location in background")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        fusedLocationClient.removeLocationUpdates(locationCallback)
    }
}

// ─────────────────────────────────────────────────────────────
// In your MainActivity.kt — start the service:
// ─────────────────────────────────────────────────────────────
/*
// Request permissions first, then:
val serviceIntent = Intent(this, LocationReporterService::class.java)
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    startForegroundService(serviceIntent)
} else {
    startService(serviceIntent)
}
*/
