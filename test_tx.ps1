$login = Invoke-WebRequest -Uri "http://localhost:3000/api/login" -Method POST -Body '{"username":"admin","password":"admin123"}' -ContentType "application/json" -UseBasicParsing
$token = ($login.Content | ConvertFrom-Json).token
$body = '{"tx":{"id":"","transaction_number":"","type":"in","material_id":"59ecf3b1-33a9-413a-bac9-7b82ad5c9e17","warehouse_id":"64e199aa-c680-4838-b5ba-3e3cbcf2cce0","rack_id":null,"quantity":2,"price":5000,"reference":"","notes":"","user_id":null,"status":"approved","approved_by":null,"po_number":"","invoice_no":"","destination":null,"created_at":"2026-07-27 10:00:00","updated_at":null}}'
try {
    $create = Invoke-WebRequest -Uri "http://localhost:3000/api/transactions" -Method POST -Headers @{"Authorization"="Bearer $token"} -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Output "SUCCESS: $($create.StatusCode) - $($create.Content)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $err = $reader.ReadToEnd()
    $reader.Close()
    Write-Output "FAIL: $code - $err"
}
