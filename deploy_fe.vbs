Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command ""Remove-Item 'C:\Program Files\Thermaltrue\dist' -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item -LiteralPath 'C:\test wms\thermaltrue\dist' -Destination 'C:\Program Files\Thermaltrue\dist' -Recurse -Force""", "", "runas", 1
