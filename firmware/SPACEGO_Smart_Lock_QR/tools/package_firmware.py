from pathlib import Path
import argparse,shutil,subprocess,sys,zipfile,hashlib,json
parser=argparse.ArgumentParser();parser.add_argument('--environment',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent.parent
build=root/'.pio/build'/args.environment
target=Path(args.output).resolve();target.mkdir(parents=True,exist_ok=True)
variant='ILI9341' if args.environment=='cyd_ili9341' else 'ST7789'
prefix='SPACEGO_QR_CYD_'+variant
app=target/(prefix+'_app.bin');shutil.copyfile(build/'firmware.bin',app)
piohome=Path(__import__('os').environ.get('PLATFORMIO_CORE_DIR',str(Path.home()/'.platformio')))
bootapp=piohome/'packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin'
full=target/(prefix+'_full.bin')
subprocess.run([sys.executable,'-m','esptool','--chip','esp32','merge_bin','-o',str(full),'--flash_mode','dio','--flash_freq','40m','--flash_size','4MB','0x1000',str(build/'bootloader.bin'),'0x8000',str(build/'partitions.bin'),'0xe000',str(bootapp),'0x10000',str(app)],check=True)
archive=target/(prefix+'_source.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as out:
 for p in root.rglob('*'):
  rel=p.relative_to(root)
  if p.is_file() and not any(x in {'.pio','.vscode','__pycache__'} for x in rel.parts) and rel.as_posix()!='include/secrets.h':out.write(p,rel)
manifest={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in [app,full,archive]}
(target/(prefix+'_checksums.json')).write_text(json.dumps(manifest,indent=2),encoding='utf8')
print(json.dumps({'variant':variant,'artifacts':list(manifest)}))
