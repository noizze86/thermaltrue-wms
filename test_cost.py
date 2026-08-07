import urllib.request, json

# Login
body = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:3000/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=30)
token = json.loads(resp.read())['token']
print(f'Token OK: {token[:30]}...')

# Test cost-to-serve
try:
    req2 = urllib.request.Request('http://localhost:3000/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
    resp2 = urllib.request.urlopen(req2, timeout=30)
    data = json.loads(resp2.read())
    print(f'cost-to-serve OK: {len(data.get("items",[]))} items, total_orders={data.get("total_orders_analyzed")}')
except Exception as e:
    print(f'cost-to-serve FAILED: {type(e).__name__}: {e}')

# Test efficiency-penalty
try:
    req3 = urllib.request.Request('http://localhost:3000/api/cost/efficiency-penalty', headers={'Authorization':f'Bearer {token}'}, method='GET')
    resp3 = urllib.request.urlopen(req3, timeout=30)
    data = json.loads(resp3.read())
    print(f'efficiency-penalty OK: {len(data.get("details",[]))} details')
except Exception as e:
    print(f'efficiency-penalty FAILED: {type(e).__name__}: {e}')
