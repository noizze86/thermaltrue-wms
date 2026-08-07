Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ""C:\test wms\thermaltrue\check_start.ps1""", "", "runas", 1
