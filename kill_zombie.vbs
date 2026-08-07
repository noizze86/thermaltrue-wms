Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command ""Stop-Process -Id 11344 -Force -ErrorAction SilentlyContinue; Stop-Process -Name server -Force -ErrorAction SilentlyContinue""", "", "runas", 1
