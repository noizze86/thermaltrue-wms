Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ""C:\test wms\thermaltrue\deploy_logged.ps1""", "", "runas", 1
