import socket, ssl, json

# Login first
body = json.dumps({'username':'admin','password':'admin123'})
req = f'POST /api/login HTTP/1.1\r\nHost: localhost:3000\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n{body}'

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(30)
s.connect(('127.0.0.1', 3000))
s.sendall(req.encode())
resp = b''
while True:
    try:
        chunk = s.recv(4096)
        if not chunk:
            break
        resp += chunk
    except:
        break
s.close()

# Extract token
headers_part, body_part = resp.split(b'\r\n\r\n', 1)
token = json.loads(body_part)['token']
print(f'Token: {token[:30]}...')

# Now test cost-to-serve
req2 = f'GET /api/cost/cost-to-serve HTTP/1.1\r\nHost: localhost:3000\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n'

s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s2.settimeout(30)
s2.connect(('127.0.0.1', 3000))
s2.sendall(req2.encode())

resp2 = b''
try:
    while True:
        chunk = s2.recv(4096)
        if not chunk:
            break
        resp2 += chunk
except socket.timeout:
    print("Timeout - no response received")
except Exception as e:
    print(f"Error: {e}")

if resp2:
    print(f'Response ({len(resp2)} bytes):')
    print(resp2[:500].decode('utf-8', errors='replace'))
else:
    print('No response received - connection closed by server')
s2.close()
