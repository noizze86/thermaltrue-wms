import subprocess, os, time, signal, json, urllib.request

# Set env to use a different port
env = os.environ.copy()
env['PORT'] = '3001'
env['JWT_SECRET'] = '25532fa5e9ce443a2d806993234f67536ee0632d7014e736dbe04c46da51252e'
env['DATABASE_URL'] = 'postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable'
env['RUST_LOG'] = 'debug'
env['APP_MODE'] = 'development'

# Kill any old test server on port 3001
try:
    proc = subprocess.run(['taskkill', '/F', '/IM', 'server.exe'], capture_output=True, text=True, timeout=5)
except:
    pass
time.sleep(2)

# Start new server on port 3001
proc = subprocess.Popen(
    ['C:\\test wms\\thermaltrue\\target\\release\\server.exe', 'run'],  # NEW binary
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    env=env,
    cwd='C:\\test wms\\thermaltrue'
)
print(f'Server started PID={proc.pid}, waiting...')
time.sleep(5)

# Check if running
poll = proc.poll()
if poll is not None:
    print(f'Server exited immediately with code {poll}')
    print(proc.stdout.read(2000).decode('utf-8', errors='replace'))
else:
    print('Server is running')
    
    # Test health
    try:
        req = urllib.request.Request('http://localhost:3001/api/health', method='GET')
        resp = urllib.request.urlopen(req, timeout=5)
        print(f'Health: {resp.status}')
    except Exception as e:
        print(f'Health failed: {e}')
    
    # Login
    try:
        body = json.dumps({'username':'admin','password':'admin123'}).encode()
        req = urllib.request.Request('http://localhost:3001/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
        resp = urllib.request.urlopen(req, timeout=30)
        token = json.loads(resp.read())['token']
        print(f'Login OK')
        
        # Test cost-to-serve
        req2 = urllib.request.Request('http://localhost:3001/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
        resp2 = urllib.request.urlopen(req2, timeout=30)
        data2 = json.loads(resp2.read())
        print(f'cost-to-serve OK: {len(data2.get("items",[]))} items, total={data2.get("total_orders_analyzed")}')
        
        # Test efficiency-penalty
        req3 = urllib.request.Request('http://localhost:3001/api/cost/efficiency-penalty', headers={'Authorization':f'Bearer {token}'}, method='GET')
        resp3 = urllib.request.urlopen(req3, timeout=30)
        data3 = json.loads(resp3.read())
        print(f'efficiency-penalty OK: {len(data3.get("details",[]))} details')
        
    except Exception as e:
        print(f'Test failed: {e}')
    
    # Read any output from server
    time.sleep(1)
    if proc.poll() is None:
        print('Server still running')
    else:
        out = proc.stdout.read(2000).decode('utf-8', errors='replace')
        print(f'Server output: {out}')
    
    # Kill server
    proc.terminate()
    time.sleep(1)
    if proc.poll() is None:
        proc.kill()
    print('Server stopped')
