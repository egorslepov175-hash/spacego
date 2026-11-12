#pragma once
#include "protocol.h"
// PUBLIC TEST VECTOR: never used as a device credential.
inline bool protocolSelfTest(){
JsonDocument doc;JsonObject c=doc.to<JsonObject>();
c["v"]=1;
c["device_id"]="d_12121212121212121212121212121212";
c["command_id"]="12345678-1234-4234-8234-123456789abc";
c["seq"]=42;
c["issued_at"]=1794470400;
c["expires_at"]=1794470412;
c["pulse_ms"]=800;
c["boot_id"]="abababababababababababababababababababababababababababababababab";
c["challenge"]="cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
const String key="000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
return commandCanonical(c)=="SG-CMD-1\nd_12121212121212121212121212121212\n12345678-1234-4234-8234-123456789abc\n42\n1794470400\n1794470412\n800\nabababababababababababababababababababababababababababababababab\ncdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd" && constantEqual(signHmac(key,commandCanonical(c)),"9db0e2779fe3e82a87c46fa96d2fc7e29a61ef2dd9312cc9ea2791b9410aacd9") && constantEqual(signHmac(key,requestCanonical("/api/device/poll","1794470400","efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef","{\"boot_id\":\"abababababababababababababababababababababababababababababababab\",\"challenge\":\"cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd\"}")),"e4e1afaa006189d1e85c036948f0e720d999ca328c004d3d71c36b4d846e096c");
}
