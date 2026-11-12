#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>

inline String bytesHex(const uint8_t* value, size_t length) {
  static const char h[]="0123456789abcdef"; String out;out.reserve(length*2);
  for(size_t i=0;i<length;i++){out+=h[value[i]>>4];out+=h[value[i]&15];}return out;
}
inline bool hexBytes(const String& value, uint8_t* out, size_t length) {
  if(value.length()!=length*2)return false;
  for(size_t i=0;i<length;i++){char a=value[i*2],b=value[i*2+1];if(!isxdigit(a)||!isxdigit(b)||isupper(a)||isupper(b))return false;out[i]=(a<='9'?a-'0':a-'a'+10)*16+(b<='9'?b-'0':b-'a'+10);}return true;
}
inline String randomHex(size_t length=32){uint8_t bytes[32];if(length>sizeof(bytes))return "";esp_fill_random(bytes,length);return bytesHex(bytes,length);}
inline String hash256(const String& value){uint8_t result[32];mbedtls_sha256_ret(reinterpret_cast<const uint8_t*>(value.c_str()),value.length(),result,0);return bytesHex(result,32);}
inline String signHmac(const String& keyHex,const String& value){uint8_t key[32],result[32];if(!hexBytes(keyHex,key,32))return "";if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,32,reinterpret_cast<const uint8_t*>(value.c_str()),value.length(),result)!=0)return "";return bytesHex(result,32);}
inline bool constantEqual(const String& a,const String& b){if(a.length()!=64||b.length()!=64)return false;uint8_t diff=0;for(size_t i=0;i<64;i++)diff|=a[i]^b[i];return diff==0;}
inline String requestCanonical(const String& path,const String& stamp,const String& nonce,const String& body){return "SG-REQ-1\nPOST\n"+path+"\n"+stamp+"\n"+nonce+"\n"+hash256(body);}
inline String commandCanonical(JsonObjectConst c){String result="SG-CMD-1\n";result+=c["device_id"].as<String>();result+='\n';result+=c["command_id"].as<String>();result+='\n';result+=String(c["seq"].as<uint64_t>());result+='\n';result+=String(c["issued_at"].as<uint64_t>());result+='\n';result+=String(c["expires_at"].as<uint64_t>());result+='\n';result+=String(c["pulse_ms"].as<uint32_t>());result+='\n';result+=c["boot_id"].as<String>();result+='\n';result+=c["challenge"].as<String>();return result;}
