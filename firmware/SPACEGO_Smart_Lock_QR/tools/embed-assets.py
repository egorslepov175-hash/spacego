from pathlib import Path
root=Path(__file__).resolve().parent.parent
logo=root.parents[1]/'dist/assets/spacego-logo.jpg'
data=logo.read_bytes()
lines=[', '.join(f'0x{x:02x}' for x in data[i:i+20]) for i in range(0,len(data),20)]
(root/'include/logo_jpg.h').write_text('#pragma once\n#include <Arduino.h>\n// Original user-provided JPEG; bytes are unchanged.\nconst uint8_t spacegoLogoJpg[] PROGMEM = {\n'+',\n'.join(lines)+'\n};\n',encoding='utf8')
roots='\n'.join((root/'tools'/p).read_text(encoding='ascii') for p in ['gtsr4.pem','isrgrootx1.pem'])
assert roots.count('-----BEGIN CERTIFICATE-----')==2
(root/'include/trust_roots.h').write_text('#pragma once\n#include <Arduino.h>\n// Public GTS Root R4 and ISRG Root X1, downloaded from their issuers.\nconst char SPACEGO_TRUST_ROOTS[] PROGMEM = R"ROOTS('+roots+')ROOTS";\n',encoding='utf8')
print('Embedded unchanged logo JPEG and two public CA roots')
