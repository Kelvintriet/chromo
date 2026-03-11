import { walk } from "https://deno.land/std@0.210.0/fs/mod.ts";
import { encodeHex } from "https://deno.land/std@0.210.0/encoding/hex.ts";
import { crypto } from "https://deno.land/std@0.210.0/crypto/mod.ts";

export async function compress(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data.buffer as ArrayBuffer]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decompress(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([data.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function getFileHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
    return encodeHex(hashBuffer);
}

export async function getFilesToTrack(): Promise<string[]> {
    const files: string[] = [];
    for await (const entry of walk(".", {
        includeDirs: false,
        skip: [/\.chromolite/, /node_modules/, /\.git/]
    })) {
        files.push(entry.path);
    }
    return files;
}
