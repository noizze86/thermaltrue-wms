Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command ""& 'C:\test wms\thermaltrue\deploy.ps1'""", "", "runas", 0
