Set shell = CreateObject("Shell.Application")
shell.ShellExecute "powershell", "-NoProfile -Command ""sc start ThermaltrueServer""", "", "runas", 0
