"Running as: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)" | Out-File C:\test wms\thermaltrue\admin_result.txt
"Date: $(Get-Date)" | Out-File C:\test wms\thermaltrue\admin_result.txt -Append
