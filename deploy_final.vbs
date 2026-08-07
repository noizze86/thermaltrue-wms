Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell", "-NoProfile -ExecutionPolicy Bypass -File C:\TESTWM~1\thermaltrue\deploy_elevated_ps.ps1", "", "runas", 0
