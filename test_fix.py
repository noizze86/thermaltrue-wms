import subprocess, os, time, json, urllib.request

env = os.environ.copy()
env['PORT'] = '3004'
env['JWT_SECRET'] = '25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e'
env['DATABASE_URL'] = 'postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable'
env['RUST_LOG'] = 'info'
env['APP_MODE'] = 'development'

logfile = open(r'C:\test wms\thermaltrue\server_fix.log', 'w', buffering=1)
proc = subprocess.Popen(
    [r'C:\test wms\thermaltrue\target\release\server.exe', 'run'],
    stdout=logfile, stderr=subprocess.STDOUT, env=env, cwd=r'C:\test wms\thermaltrue'
)
print(f'Started PID={proc.pid}')
time.sleep(5)

if proc.poll() is not None:
    print(f'SERVER EXITED code={proc.returncode}')
    logfile.close()
    exit(1)

print('Testing...')

# Health
r = urllib.request.urlopen('http://localhost:3004/api/health', timeout=5)
print(f'Health: {r.status}')

# Login
body = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:3004/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=10)
token = json.loads(resp.read())['token']
print(f'Login OK')

# cost-to-serve
req = urllib.request.Request('http://localhost:3004/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=30)
data = json.loads(resp.read())
print(f'cost-to-serve: {len(data.get("items",[]))} items, total_orders={data.get("total_orders_analyzed")}')

# efficiency-penalty
req = urllib.request.Request('http://localhost:3004/api/cost/efficiency-penalty', headers={'Authorization':f'Bearer {token}'}, method='GET')
resp = urllib.request.urlopen(req, timeout=30)
data = json.loads(resp.read())
print(f'efficiency-penalty: {len(data.get("details",[]))} details')

print('ALL TESTS PASSED')

logfile.close()
proc.terminate()
time.sleep(2)
if proc.poll() is None:
    proc.kill()
print('Server stopped')
