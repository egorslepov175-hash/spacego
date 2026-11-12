#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <U8g2_for_Adafruit_GFX.h>
#include <TJpg_Decoder.h>
#include <qrcode.h>
#include <esp_timer.h>
#include <driver/gpio.h>
#include <time.h>
#include "protocol.h"
#include "protocol_selftest.h"
#include "trust_roots.h"
#include "logo_jpg.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "config.example.h"
#endif
#ifdef SPACEGO_TFT_ST7789
#include <Adafruit_ST7789.h>
#else
#include <Adafruit_ILI9341.h>
#endif

static_assert(SPACEGO_RELAY_GPIO==22||SPACEGO_RELAY_GPIO==27,"CYD: use exposed GPIO 22 or 27; GPIO 32 is touch MOSI.");
static_assert(SPACEGO_MAX_PULSE_MS>=100&&SPACEGO_MAX_PULSE_MS<=5000,"Relay pulse must be 100..5000 ms.");
static constexpr uint8_t TFT_CS=15,TFT_DC=2,TFT_SCK=14,TFT_MISO=12,TFT_MOSI=13,TFT_BL=21;
static constexpr uint16_t BLACK=0x0000,WHITE=0xffff,GREEN=0x074f,GREY=0xad75;
static constexpr uint8_t RELAY_ON=SPACEGO_RELAY_ACTIVE_HIGH?HIGH:LOW,RELAY_OFF=SPACEGO_RELAY_ACTIVE_HIGH?LOW:HIGH;
static const char* FW_VERSION="spacego-cyd-qr-1.0.0";
SPIClass screenSPI(HSPI);
#ifdef SPACEGO_TFT_ST7789
Adafruit_ST7789 tft(&screenSPI,TFT_CS,TFT_DC,-1);
#else
Adafruit_ILI9341 tft(&screenSPI,TFT_DC,TFT_CS,-1);
#endif
U8G2_FOR_ADAFRUIT_GFX font;
Preferences prefs;
esp_timer_handle_t relayTimer=nullptr;
volatile bool relayActive=false,relayFinished=false;
portMUX_TYPE relayMux=portMUX_INITIALIZER_UNLOCKED;
bool nvsReady=false,qrReady=false,hasOpened=false;
String deviceId,deviceSecret,registrationId,bootId,qrUrl,ackId;
String wifiSsid,wifiPassword,enrollmentCode,serialLine;
uint64_t lastSequence=0,ackSequence=0;
uint32_t lastOpenMs=0,lastPollMs=0,lastWifiMs=0,lastErrorPaintMs=0,showOpenUntil=0,lastAckMs=0;
String screenStatus;
QRCode qr;
uint8_t qrModules[4096];

void relayOff(){portENTER_CRITICAL(&relayMux);gpio_set_level(static_cast<gpio_num_t>(SPACEGO_RELAY_GPIO),RELAY_OFF);relayActive=false;portEXIT_CRITICAL(&relayMux);}
void relayTimeout(void*){relayOff();relayFinished=true;}
void line(const char* text,int16_t y,uint16_t color=WHITE){font.setForegroundColor(color);font.setCursor(12,y);font.print(text);}
bool jpegBlock(int16_t x,int16_t y,uint16_t w,uint16_t h,uint16_t* pixels){if(y>=60)return false;tft.drawRGBBitmap(x,y,pixels,w,h);return true;}
void brand(){tft.fillRect(0,0,240,62,BLACK);TJpgDec.drawJpg(9,-27,spacegoLogoJpg,sizeof(spacegoLogoJpg));}
void screen(const String& status,bool opened=false){
  if(status==screenStatus&&!opened)return;screenStatus=status;tft.fillScreen(BLACK);brand();
  if(opened){line("Доступ разрешён",128,GREEN);line("Ворота открываются",153,WHITE);line("Ожидайте завершения",194,GREY);line("импульса реле",212,GREY);return;}
  if(qrReady){const int quiet=4,scale=min(4,200/static_cast<int>(qr.size+quiet*2));const int edge=(qr.size+quiet*2)*scale,x=(240-edge)/2,y=64;tft.fillRect(x,y,edge,edge,WHITE);for(uint8_t row=0;row<qr.size;row++)for(uint8_t col=0;col<qr.size;col++)if(qrcode_getModule(&qr,col,row))tft.fillRect(x+(quiet+col)*scale,y+(quiet+row)*scale,scale,scale,BLACK);
    line("Отсканируйте для",285);line("получения доступа",301);font.setForegroundColor(GREY);font.setCursor(12,318);font.print(status);
  }else{line("SPACEGO QR Edition",112,GREEN);font.setCursor(12,148);font.print(status);line("Настройка: README",198,GREY);line("Клавиатуры и PIN нет",219,GREY);}
}
bool makeQr(){if(qrUrl.length()>180||!qrUrl.startsWith("https://"))return false;for(uint8_t v=3;v<=9;v++)if(qrcode_getBufferSize(v)<=sizeof(qrModules)&&qrcode_initText(&qr,qrModules,v,ECC_MEDIUM,qrUrl.c_str())==0)return true;return false;}

class BoundedResponse:public Stream{
 public:char data[4097]={0};size_t length=0;bool overflow=false;
 size_t write(uint8_t b)override{if(length>=4096){overflow=true;return 0;}data[length++]=b;data[length]=0;return 1;}
 size_t write(const uint8_t* src,size_t n)override{if(n>4096-length){overflow=true;return 0;}memcpy(data+length,src,n);length+=n;data[length]=0;return n;}
 int available()override{return 0;}int read()override{return -1;}int peek()override{return -1;}void flush()override{}
};

int post(const String& path,const String& body,JsonDocument& response,bool authenticated=true){
 if(WiFi.status()!=WL_CONNECTED||time(nullptr)<1735689600)return -1;
 const String origin=SPACEGO_BACKEND_ORIGIN;if(!origin.startsWith("https://")||origin.endsWith("/")||origin.indexOf('?',8)>=0)return -2;
 WiFiClientSecure tls;tls.setCACert(SPACEGO_TRUST_ROOTS);tls.setHandshakeTimeout(6);
 HTTPClient http;http.setConnectTimeout(5000);http.setTimeout(5000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
 if(!http.begin(tls,origin+path))return -3;http.addHeader("Content-Type","application/json");
 if(authenticated){String stamp=String(static_cast<uint32_t>(time(nullptr))),nonce=randomHex();http.addHeader("X-Spacego-Device",deviceId);http.addHeader("X-Spacego-Time",stamp);http.addHeader("X-Spacego-Nonce",nonce);http.addHeader("X-Spacego-Signature",signHmac(deviceSecret,requestCanonical(path,stamp,nonce,body)));}
 int code=http.POST(body);BoundedResponse result;
 if(code>0){int read=http.writeToStream(&result);if(read<0||result.overflow||deserializeJson(response,result.data,result.length))code=-4;}
 http.end();return code;
}

bool saveString(const char* key,const String& value){return prefs.putString(key,value)==value.length();}
bool registerDevice(){
 if(!nvsReady)return false;
 if(deviceSecret.length()!=64||registrationId.length()!=64){deviceSecret=randomHex();registrationId=randomHex();JsonDocument pending;pending["key"]=deviceSecret;pending["regid"]=registrationId;String value;serializeJson(pending,value);if(!saveString("pending",value)){screen("Ошибка хранилища");return false;}}
 if(enrollmentCode.length()!=64){screen("Нужен код подключения");return false;}
 JsonDocument request,response;request["enrollment_code"]=enrollmentCode;request["registration_id"]=registrationId;request["device_secret"]=deviceSecret;request["fw_version"]=FW_VERSION;String body;serializeJson(request,body);
 int status=post("/api/device/register",body,response,false);if(status!=200){screen(status==401?"Код истёк: обновите":"Регистрация недоступна");return false;}
 const String id=response["device_id"]|"",url=response["qr_url"]|"";
 if(!id.startsWith("d_")||id.length()!=34||!url.startsWith("https://")||url.length()>180){screen("Ошибка ответа сервера");return false;}
 JsonDocument bundle;bundle["id"]=id;bundle["url"]=url;bundle["key"]=deviceSecret;bundle["regid"]=registrationId;String encoded;serializeJson(bundle,encoded);
 if(!saveString("devicecfg",encoded)){screen("Ошибка хранилища");return false;}
 deviceId=id;qrUrl=url;JsonDocument consumed;deserializeJson(consumed,prefs.getString("consumed","{}"));lastSequence=consumed["id"].as<String>()==deviceId?consumed["seq"].as<uint64_t>():0;qrReady=makeQr();if(!qrReady)screen("QR слишком длинный");return qrReady;
}

bool verifyCommand(JsonObjectConst c,const String& challenge){
 const uint64_t t=static_cast<uint64_t>(time(nullptr));
 if(c["v"]!=1||c["device_id"].as<String>()!=deviceId||c["boot_id"].as<String>()!=bootId||c["challenge"].as<String>()!=challenge)return false;
 if(!c["seq"].is<uint64_t>()||!c["issued_at"].is<uint64_t>()||!c["expires_at"].is<uint64_t>()||!c["pulse_ms"].is<uint32_t>())return false;
 const uint64_t seq=c["seq"],issued=c["issued_at"],expires=c["expires_at"];
 const uint32_t pulse=c["pulse_ms"];
 if(seq==0||seq>9007199254740991ULL||seq<=lastSequence||issued>t+3||expires<=t||expires<=issued||expires-issued>15||pulse<100||pulse>SPACEGO_MAX_PULSE_MS)return false;
 const String id=c["command_id"]|"";if(id.length()!=36)return false;
 return constantEqual(c["signature"].as<String>(),signHmac(deviceSecret,commandCanonical(c)));
}

void acceptCommand(JsonObjectConst c,const String& challenge){
 if(relayActive||!ackId.isEmpty()||WiFi.status()!=WL_CONNECTED||!verifyCommand(c,challenge))return;
 if(hasOpened&&static_cast<uint32_t>(millis()-lastOpenMs)<SPACEGO_MIN_OPEN_INTERVAL_MS)return;
 const uint64_t sequence=c["seq"];
 // Persist before energizing the relay: a reset can lose an opening, never repeat it.
 JsonDocument consumed;consumed["id"]=deviceId;consumed["seq"]=sequence;String saved;serializeJson(consumed,saved);
 if(!saveString("consumed",saved)){relayOff();screen("Ошибка NVS: вход закрыт");return;}
 lastSequence=sequence;ackId=c["command_id"].as<String>();ackSequence=sequence;
 relayFinished=false;relayActive=true;lastOpenMs=millis();hasOpened=true;
 // Critical section prevents the cutoff from racing a delayed GPIO assertion.
 portENTER_CRITICAL(&relayMux);
 const esp_err_t armed=esp_timer_start_once(relayTimer,static_cast<uint64_t>(c["pulse_ms"].as<uint32_t>())*1000);
 if(armed==ESP_OK)gpio_set_level(static_cast<gpio_num_t>(SPACEGO_RELAY_GPIO),RELAY_ON);
 portEXIT_CRITICAL(&relayMux);
 if(armed!=ESP_OK){relayOff();ackId="";screen("Ошибка таймера реле");return;}
 showOpenUntil=millis()+max(3500UL,c["pulse_ms"].as<uint32_t>()+500UL);screen("Доступ разрешён",true);
}

void acknowledge(){
 if(ackId.isEmpty()||!relayFinished||WiFi.status()!=WL_CONNECTED)return;
 JsonDocument request,response;request["command_id"]=ackId;request["seq"]=ackSequence;request["boot_id"]=bootId;request["result"]="executed";String body;serializeJson(request,body);
 const int code=post("/api/device/ack",body,response);if(code==200||code==404)ackId="";
}
void poll(){
 JsonDocument request,response;const String challenge=randomHex();request["boot_id"]=bootId;request["challenge"]=challenge;request["fw_version"]=FW_VERSION;String body;serializeJson(request,body);
 const int code=post("/api/device/poll",body,response);
 if(code!=200){relayOff();if(millis()-lastErrorPaintMs>5000){screen(code==401?"Устройство отключено":"Нет связи с сервером");lastErrorPaintMs=millis();}return;}
 if(!response["command"].isNull())acceptCommand(response["command"].as<JsonObjectConst>(),challenge);
 else if(!showOpenUntil)screen("Устройство на связи");
}

void serialSetup(){
 while(Serial.available()){
  const char c=Serial.read();if(c=='\r')continue;
  if(c!='\n'){if(serialLine.length()<768)serialLine+=c;else serialLine="INVALID";continue;}
  if(serialLine.startsWith("SETUP ")){
   JsonDocument setup;const auto err=deserializeJson(setup,serialLine.substring(6));
   const String ssid=setup["ssid"]|"",pass=setup["password"]|"",code=setup["enrollment_code"]|"";
   if(err||ssid.isEmpty()||ssid.length()>32||pass.length()>63||(!code.isEmpty()&&code.length()!=64)){Serial.println("SPACEGO_SETUP_ERROR invalid_configuration");}
   else {relayOff();esp_timer_stop(relayTimer);String encoded;serializeJson(setup,encoded);if(saveString("setup",encoded)){if(!code.isEmpty())prefs.remove("devicecfg");if(!code.isEmpty())prefs.remove("pending");Serial.println("SPACEGO_SETUP_OK restarting");Serial.flush();delay(150);ESP.restart();}else Serial.println("SPACEGO_SETUP_ERROR nvs_write_failed");}
  }else if(serialLine=="INFO")Serial.println("SPACEGO_QR 1.0.0 CYD GPIO22 no_touch no_pin");
  // Never echo SSID, password, enrollment code or device key.
  serialLine="";
 }
}

void setup(){
 // gpio_set_level sets the output latch while the pin is still an input.
 gpio_set_level(static_cast<gpio_num_t>(SPACEGO_RELAY_GPIO),RELAY_OFF);gpio_set_direction(static_cast<gpio_num_t>(SPACEGO_RELAY_GPIO),GPIO_MODE_OUTPUT);relayOff();
 esp_timer_create_args_t timerArgs={};timerArgs.callback=relayTimeout;timerArgs.name="relay_cutoff";
 if(esp_timer_create(&timerArgs,&relayTimer)!=ESP_OK){for(;;){relayOff();delay(1000);}}
 Serial.begin(115200);Serial.println("SPACEGO QR Edition: no keypad, no PIN. Relay OFF.");
 pinMode(33,OUTPUT);digitalWrite(33,HIGH); // Keep touch controller deselected; never initialize touch.
 pinMode(5,OUTPUT);digitalWrite(5,HIGH); // Keep unused SD deselected.
 pinMode(TFT_BL,OUTPUT);digitalWrite(TFT_BL,LOW);screenSPI.begin(TFT_SCK,TFT_MISO,TFT_MOSI,TFT_CS);
#ifdef SPACEGO_TFT_ST7789
 tft.init(240,320,SPI_MODE0);
#else
 tft.begin(20000000);
#endif
 tft.setRotation(0);digitalWrite(TFT_BL,HIGH);font.begin(tft);font.setFont(u8g2_font_6x13_t_cyrillic);font.setFontMode(1);font.setBackgroundColor(BLACK);TJpgDec.setJpgScale(8);TJpgDec.setSwapBytes(false);TJpgDec.setCallback(jpegBlock);
 if(!protocolSelfTest()){screen("Криптография: ошибка");return;}
 nvsReady=prefs.begin("spacego",false);if(!nvsReady){screen("NVS недоступно");return;}
 JsonDocument stored;deserializeJson(stored,prefs.getString("devicecfg",prefs.getString("pending","{}")));deviceId=stored["id"]|"";deviceSecret=stored["key"]|"";registrationId=stored["regid"]|"";qrUrl=stored["url"]|"";
 JsonDocument consumed;deserializeJson(consumed,prefs.getString("consumed","{}"));lastSequence=consumed["id"].as<String>()==deviceId?consumed["seq"].as<uint64_t>():0;
 JsonDocument setup;deserializeJson(setup,prefs.getString("setup","{}"));wifiSsid=setup["ssid"]|SPACEGO_WIFI_SSID;wifiPassword=setup["password"]|SPACEGO_WIFI_PASSWORD;enrollmentCode=setup["enrollment_code"]|SPACEGO_ENROLLMENT_CODE;
 if(!qrUrl.isEmpty())qrReady=makeQr();screen("Подключение Wi-Fi");
 if(wifiSsid.isEmpty()){screen("Настройте через USB");return;}
 WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.persistent(false);WiFi.begin(wifiSsid.c_str(),wifiPassword.c_str());configTime(0,0,"time.cloudflare.com","pool.ntp.org","time.google.com");
}
void loop(){
 if(nvsReady)serialSetup();
 if(!nvsReady||wifiSsid.isEmpty()){relayOff();delay(50);return;}
 if(WiFi.status()!=WL_CONNECTED){relayOff();if(millis()-lastWifiMs>10000){lastWifiMs=millis();WiFi.reconnect();screen("Нет подключения Wi-Fi");}delay(20);return;}
 if(time(nullptr)<1735689600){relayOff();screen("Синхронизация времени");delay(20);return;}
 if(bootId.isEmpty())bootId=randomHex();
 if(deviceId.isEmpty()){if(millis()-lastPollMs>10000){lastPollMs=millis();registerDevice();}delay(20);return;}
 if(showOpenUntil&&static_cast<int32_t>(millis()-showOpenUntil)>=0){showOpenUntil=0;screenStatus="";screen("Устройство на связи");}
 if(relayFinished&&!ackId.isEmpty()&&millis()-lastAckMs>2000){lastAckMs=millis();acknowledge();}
 if(!relayActive&&ackId.isEmpty()&&millis()-lastPollMs>=SPACEGO_POLL_INTERVAL_MS){lastPollMs=millis();poll();}
 delay(10);
}
