Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ""C:\test wms\thermaltrue\test_server_3001.ps1""", "", "runas", 1
