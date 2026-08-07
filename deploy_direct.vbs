Set shell = CreateObject("Shell.Application")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""sc.exe stop ThermaltrueServer; Start-Sleep -Seconds 3; Copy-Item 'C:\test wms\thermaltrue\target\release\server.exe' 'C:\Program Files\Thermaltrue\server.exe' -Force; Start-Sleep -Seconds 2; sc.exe start ThermaltrueServer"""
shell.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command """ & cmd & """", "", "runas", 0
