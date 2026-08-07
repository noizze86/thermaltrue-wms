import subprocess, sys, os, signal, time, json, urllib.request

# Check current server
try:
    req = urllib.request.Request('http://localhost:3000/api/health', method='GET')
    resp = urllib.request.urlopen(req, timeout=5)
    print(f"Current server is running and responds: {resp.read().decode()}")
except Exception as e:
    print(f"Cannot reach server: {e}")
    sys.exit(1)

# Try to kill the server process via taskkill
print("Attempting to stop the service process...")
result = subprocess.run(['taskkill', '/F', '/IM', 'server.exe'], capture_output=True, text=True)
print(f"taskkill stdout: {result.stdout}")
print(f"taskkill stderr: {result.stderr}")

# Wait for port to free
time.sleep(5)

# Check if port is free
import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
result = sock.connect_ex(('127.0.0.1', 3000))
if result == 0:
    print("Port 3000 is still in use - cannot run our server")
    sock.close()
    sys.exit(1)
sock.close()
print("Port 3000 is free!")

# Run our new server
print("\n\n=== Starting new server.exe from target/release ===")
subprocess.Popen(
    ['C:\\test wms\\thermaltrue\\target\\release\\server.exe', 'run'],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT
)

time.sleep(5)

# Test cost-to-serve
try:
    body = json.dumps({'username':'admin','password':'admin123'}).encode()
    req = urllib.request.Request('http://localhost:3000/api/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
    resp = urllib.request.urlopen(req, timeout=30)
    token = json.loads(resp.read())['token']
    print(f'\nLogged in, token: {token[:30]}...')
    
    req2 = urllib.request.Request('http://localhost:3000/api/cost/cost-to-serve', headers={'Authorization':f'Bearer {token}'}, method='GET')
    resp2 = urllib.request.urlopen(req2, timeout=30)
    data = json.loads(resp2.read())
    print(f'cost-to-serve OK: {len(data.get("items",[]))} items')
except Exception as e:
    print(f'cost-to-serve FAILED: {type(e).__name__}: {e}')
