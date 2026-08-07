Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ""C:\test wms\thermaltrue\run_server_direct2.ps1""", "", "runas", 1
