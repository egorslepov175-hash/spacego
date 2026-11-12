param([Parameter(Mandatory=$true)][string]$Port,[string]$Firmware="SPACEGO_QR_CYD_ILI9341_full.bin")
$ErrorActionPreference="Stop"
$FirmwarePath=Join-Path (Get-Location) $Firmware
if (!(Test-Path -LiteralPath $FirmwarePath)) { throw "Put the full firmware .bin in this folder or pass -Firmware with its path." }
python -m esptool --chip esp32 --port $Port --baud 460800 write_flash 0x0 $FirmwarePath
if ($LASTEXITCODE -ne 0) { throw "Flashing failed. Check the USB port and BOOT button." }
Write-Host "Flashed. Run python tools/configure_device.py to set Wi-Fi and enrollment."
