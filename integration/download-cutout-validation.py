"""Download pinned public model/test images into the external validation cache."""
import concurrent.futures
import hashlib
import os
from pathlib import Path
import requests

root = Path(os.environ['LOCALAPPDATA']) / 'AI-Creative-Studio' / 'cutout-validation'
root.mkdir(parents=True, exist_ok=True)
destination = root / 'birefnet-lite-512-verified.onnx'
size = 191877254
checksum = '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2'
url = 'https://huggingface.co/studioludens/birefnet-lite-512/resolve/4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7/onnx/model.onnx'
if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != checksum:
    if not destination.exists() or destination.stat().st_size != size:
        with destination.open('wb') as output:
            output.truncate(size)
    step = 8 * 1024 * 1024
    def chunk(start):
        end = min(size - 1, start + step - 1)
        with destination.open('rb') as existing:
            existing.seek(start)
            block = existing.read(end-start+1)
        if any(block):
            return
        for attempt in range(5):
            try:
                response = requests.get(url + f'?download=true&retrysegment={start}&attempt={attempt}', headers={'Range': f'bytes={start}-{end}'}, timeout=60)
                response.raise_for_status()
                if response.status_code != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}' or len(response.content) != end - start + 1:
                    raise RuntimeError('Range response mismatch')
                with destination.open('r+b') as output:
                    output.seek(start)
                    output.write(response.content)
                print(f'chunk {start // step + 1} verified ({end + 1}/{size})', flush=True)
                return
            except Exception as error:
                if attempt == 4:
                    raise
                print(f'retry chunk {start // step + 1}: {type(error).__name__}', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(chunk, range(0, size, step)))
actual = hashlib.sha256(destination.read_bytes()).hexdigest()
if actual != checksum:
    raise RuntimeError(f'Invalid model checksum {actual}')
print('SHA256 VERIFIED', actual, flush=True)
for name in ['car-1.jpg', 'plants-1.jpg', 'cloth-1.jpg']:
    response = requests.get(f'https://raw.githubusercontent.com/danielgatis/rembg/main/tests/fixtures/{name}', timeout=60)
    response.raise_for_status()
    (root / name).write_bytes(response.content)
print('Validation images ready', flush=True)
