export function binaryBytes(data: string | number[]): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") {
    const b64 = data.includes(",") ? data.split(",")[1] : data;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return Uint8Array.from(data);
}

export function zipDataUrl(base64: string): string {
  return `data:application/zip;base64,${base64}`;
}