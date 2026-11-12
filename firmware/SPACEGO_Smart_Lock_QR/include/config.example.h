#pragma once
// Copy to secrets.h. Never commit credentials to GitHub.
#define SPACEGO_WIFI_SSID ""
#define SPACEGO_WIFI_PASSWORD ""
#define SPACEGO_BACKEND_ORIGIN "https://spacego-lock-api.slepovnew2.chatgpt.site"
// Create a 15-minute enrollment code in the owner's device dashboard.
#define SPACEGO_ENROLLMENT_CODE ""

// ESP32-2432S028R: GPIO 32 belongs to XPT2046 touch MOSI.
// GPIO 22 is exposed on P3/CN1 and is used for the relay instead.
#define SPACEGO_RELAY_GPIO 22
// Default: 3.3 V GPIO drives an NPN/MOSFET stage; HIGH pulls relay IN low.
#define SPACEGO_RELAY_ACTIVE_HIGH true
#define SPACEGO_MAX_PULSE_MS 5000
#define SPACEGO_MIN_OPEN_INTERVAL_MS 15000
#define SPACEGO_POLL_INTERVAL_MS 2000

// Keep enabled. The provided firmware NEVER disables TLS certificate checks.
// Device keys are generated on the ESP32 and stored in NVS, not in this file.
