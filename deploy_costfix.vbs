Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "C:\test wms\thermaltrue\deploy_costfix.bat", "", "C:\Program Files\Thermaltrue", "runas", 1
