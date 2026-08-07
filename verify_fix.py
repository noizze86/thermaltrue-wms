import urllib.request, json

# Login
body = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:3000/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=10)
token = json.loads(resp.read())['token']
print(f'Login OK')

# cost-summary
req = urllib.request.Request('http://localhost:3000/api/cost/summary', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=10)
d = json.loads(resp.read())
print(f'cost-summary: OK (materials={d.get("material_count")}, carrying_rate={d.get("carrying_cost_rate")}%)')

# carrying-cost
req = urllib.request.Request('http://localhost:3000/api/cost/carrying-cost', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=30)
d = json.loads(resp.read())
print(f'carrying-cost: OK ({len(d.get("items",[]))} items, rate={d.get("carrying_cost_rate")}%)')

# cost-to-serve
req = urllib.request.Request('http://localhost:3000/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=30)
d = json.loads(resp.read())
print(f'cost-to-serve: OK ({len(d.get("items",[]))} items, total_orders={d.get("total_orders_analyzed")})')

# efficiency-penalty
req = urllib.request.Request('http://localhost:3000/api/cost/efficiency-penalty', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=30)
d = json.loads(resp.read())
print(f'efficiency-penalty: OK ({len(d.get("details",[]))} details, total_penalty={d.get("total_efficiency_penalty")})')

print('\n=== ALL ENDPOINTS WORKING ===')
