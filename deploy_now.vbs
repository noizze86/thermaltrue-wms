Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell", "-NoProfile -Command ""sc stop ThermaltrueServer; start-sleep 3; copy-item 'C:\test wms\thermaltrue\target\release\server.exe' 'C:\Program Files\Thermaltrue\server.exe' -force; sc start ThermaltrueServer""", "", "runas", 0
