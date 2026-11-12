"""USB-only first setup; credentials never go into shell arguments or logs."""
import getpass,json,sys,time
try:
 import serial
 from serial.tools import list_ports
except ImportError:
 raise SystemExit('Install requirements first: python -m pip install pyserial')
print('Available USB serial ports:')
for item in list_ports.comports():print(f'  {item.device}: {item.description}')
port=input('ESP32 port (for example COM5): ').strip()
ssid=input('Wi-Fi SSID (2.4 GHz): ').strip()
password=getpass.getpass('Wi-Fi password: ')
enrollment=getpass.getpass('15-minute owner enrollment code (blank keeps existing registration): ').strip()
if not ssid or len(ssid.encode())>32 or (enrollment and (len(enrollment)!=64 or any(c not in '0123456789abcdef' for c in enrollment))):raise SystemExit('Invalid setup fields')
payload={'ssid':ssid,'password':password,'enrollment_code':enrollment}
with serial.Serial(port,115200,timeout=1,write_timeout=3) as link:
 link.dtr=False;link.rts=False;time.sleep(2);link.reset_input_buffer()
 link.write(('SETUP '+json.dumps(payload,separators=(',',':'),ensure_ascii=True)+'\n').encode())
 deadline=time.monotonic()+15
 while time.monotonic()<deadline:
  line=link.readline().decode(errors='replace').strip()
  if line.startswith('SPACEGO_SETUP_OK'):
   print('Configuration saved. ESP32 is restarting.');break
  if line.startswith('SPACEGO_SETUP_ERROR'):raise SystemExit('ESP32 rejected configuration; check inputs and NVS.')
 else:raise SystemExit('No confirmation received. Check firmware, USB port, and close the serial monitor.')
