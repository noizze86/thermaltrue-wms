import subprocess, os, time, json, urllib.request, signal

env = os.environ.copy()
env['PORT'] = '3003'
env['JWT_SECRET'] = '25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e'
env['DATABASE_URL'] = 'postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable'
env['RUST_LOG'] = 'debug'
env['APP_MODE'] = 'development'

logfile = open(r'C:\test wms\thermaltrue\server_test.log', 'w', buffering=1)

proc = subprocess.Popen(
    [r'C:\test wms\thermaltrue\target\release\server.exe', 'run'],
    stdout=logfile,
    stderr=subprocess.STDOUT,
    env=env,
    cwd=r'C:\test wms\thermaltrue'
)
print(f'Started PID={proc.pid}')
time.sleep(5)

if proc.poll() is not None:
    print(f'SERVER EXITED with code {proc.returncode}')
    logfile.close()
    with open(r'C:\test wms\thermaltrue\server_test.log') as f:
        print(f.read(2000))
    exit(1)

print('Server running, testing...')

# Health
try:
    r = urllib.request.urlopen('http://localhost:3003/api/health', timeout=5)
    print(f'Health: {r.status}')
except Exception as e:
    print(f'Health fail: {e}')
    proc.kill()
    exit(1)

# Login
body = json.dumps({'username':'admin','password':'admin123'}).encode()
req = urllib.request.Request('http://localhost:3003/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
resp = urllib.request.urlopen(req, timeout=10)
token = json.loads(resp.read())['token']
print(f'Login OK')

# Test cost-to-serve
try:
    req2 = urllib.request.Request('http://localhost:3003/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
    resp2 = urllib.request.urlopen(req2, timeout=60)
    data = json.loads(resp2.read())
    print(f'cost-to-serve OK: {len(data.get("items",[]))} items, total_orders={data.get("total_orders_analyzed")}')
except Exception as e:
    print(f'cost-to-serve FAIL: {type(e).__name__}: {e}')

# Test efficiency-penalty
try:
    req3 = urllib.request.Request('http://localhost:3003/api/cost/efficiency-penalty', headers={'Authorization':f'Bearer {token}'}, method='GET')
    resp3 = urllib.request.urlopen(req3, timeout=60)
    data = json.loads(resp3.read())
    print(f'efficiency-penalty OK: {len(data.get("details",[]))} details')
except Exception as e:
    print(f'efficiency-penalty FAIL: {type(e).__name__}: {e}')

time.sleep(2)
print(f'Server still running: {proc.poll() is None}')

# Print log tail
logfile.close()
with open(r'C:\test wms\thermaltrue\server_test.log') as f:
    lines = f.readlines()
    print('\n=== Last 20 log lines ===')
    for line in lines[-20:]:
        print(line.rstrip())

# Kill
proc.terminate()
time.sleep(2)
if proc.poll() is None:
    proc.kill()
print('Done')
