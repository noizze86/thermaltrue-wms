Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell", "-NoProfile -Command ""taskkill /F /IM server.exe /T; Start-Sleep 3; Copy-Item 'C:\test wms\thermaltrue\target\release\server.exe' 'C:\Program Files\Thermaltrue\server.exe' -Force; Start-Sleep 2; Start-Process 'C:\Program Files\Thermaltrue\server.exe'""", "", "runas", 0
