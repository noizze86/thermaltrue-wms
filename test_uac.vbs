Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "cmd.exe", "/c ""copy /Y ""C:\test wms\thermaltrue\target\release\server.exe"" ""C:\Program Files\Thermaltrue\server.exe"" && echo SUCCESS > C:\test_uac_result.txt""", "C:\Program Files\Thermaltrue", "runas", 0
