"""Independent Python SHA256/HMAC fixtures, using a PUBLIC TEST KEY only."""
from pathlib import Path
import hashlib,hmac,json
root=Path(__file__).resolve().parent.parent
key=bytes(range(32)).hex()
command={'v':1,'device_id':'d_'+'12'*16,'command_id':'12345678-1234-4234-8234-123456789abc','seq':42,'issued_at':1794470400,'expires_at':1794470412,'pulse_ms':800,'boot_id':'ab'*32,'challenge':'cd'*32}
canonical='SG-CMD-1\n'+'\n'.join(str(command[k]) for k in ['device_id','command_id','seq','issued_at','expires_at','pulse_ms','boot_id','challenge'])
body='{"boot_id":"'+'ab'*32+'","challenge":"'+'cd'*32+'"}'
request='SG-REQ-1\nPOST\n/api/device/poll\n1794470400\n'+'ef'*32+'\n'+hashlib.sha256(body.encode()).hexdigest()
sign=lambda text:hmac.new(bytes.fromhex(key),text.encode(),hashlib.sha256).hexdigest()
fixture={'test_key':key,'command':command,'command_canonical':canonical,'command_signature':sign(canonical),'request_body':body,'request_canonical':request,'request_signature':sign(request)}
(root/'tools/protocol-vectors.json').write_text(json.dumps(fixture,indent=2),encoding='utf8')
literal=lambda value:json.dumps(value,ensure_ascii=True)
assignments=''.join('c['+literal(k)+']='+ (literal(v) if isinstance(v,str) else str(v))+';\n' for k,v in command.items())
header='#pragma once\n#include "protocol.h"\n// PUBLIC TEST VECTOR: never used as a device credential.\ninline bool protocolSelfTest(){\nJsonDocument doc;JsonObject c=doc.to<JsonObject>();\n'+assignments+'const String key='+literal(key)+';\nreturn commandCanonical(c)=='+literal(canonical)+' && constantEqual(signHmac(key,commandCanonical(c)),'+literal(sign(canonical))+') && constantEqual(signHmac(key,requestCanonical("/api/device/poll","1794470400",'+literal('ef'*32)+','+literal(body)+')),'+literal(sign(request))+');\n}\n'
(root/'include/protocol_selftest.h').write_text(header,encoding='utf8')
backend=root.parents[2]/'spacego-lock-api/test/protocol-vectors.json'
backend.write_text(json.dumps(fixture,indent=2),encoding='utf8')
print('Generated independent Python protocol fixtures and firmware startup self-test')
