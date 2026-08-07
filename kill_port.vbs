Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command ""Stop-Process -Id 11344 -Force -ErrorAction SilentlyContinue; Stop-Process -Name server -Force -ErrorAction SilentlyContinue; Start-Sleep 3; netstat -ano | Select-String ':3000 '""", "", "runas", 1
