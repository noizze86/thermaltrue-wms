Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File C:\test wms\thermaltrue\deploy_admin.ps1", "", "runas", 1
