import { describe, expect, it } from 'vitest';
import { OpfsBlobStore } from './opfs';
import { MemoryDirectoryHandle } from './memory-opfs';

const store = (): OpfsBlobStore =>
  new OpfsBlobStore(new MemoryDirectoryHandle() as unknown as FileSystemDirectoryHandle, 'blobs');

describe('OpfsBlobStore', () => {
  it('writes and reads back a blob', async () => {
    const s = store();
    const data = new TextEncoder().encode('hello laserkerf');
    await s.writeBlob('a.bin', data);
    expect(await s.has('a.bin')).toBe(true);
    expect(new TextDecoder().decode(await s.readBlob('a.bin'))).toBe('hello laserkerf');
    expect(await s.size('a.bin')).toBe(data.byteLength);
  });

  it('round-trips a 100 MB blob (the OPFS large-write path)', async () => {
    const s = store();
    const size = 100 * 1024 * 1024;
    const data = new Uint8Array(size); // zero-filled, off-heap; sentinels below
    data[0] = 1;
    data[size >> 1] = 2;
    data[size - 1] = 3;

    await s.writeBlob('big.bin', data);
    expect(await s.size('big.bin')).toBe(size);

    const back = await s.readBlob('big.bin');
    expect(back.byteLength).toBe(size);
    expect(back[0]).toBe(1);
    expect(back[size >> 1]).toBe(2);
    expect(back[size - 1]).toBe(3);
  });

  it('lists and deletes keys', async () => {
    const s = store();
    await s.writeBlob('a', new Uint8Array([1]));
    await s.writeBlob('b', new Uint8Array([2]));
    expect((await s.keys()).sort()).toEqual(['a', 'b']);

    await s.deleteBlob('a');
    expect(await s.has('a')).toBe(false);
    expect(await s.keys()).toEqual(['b']);

    await s.deleteBlob('missing'); // deleting a missing key is a no-op
  });

  it('reports has=false before any directory exists', async () => {
    expect(await store().has('nope')).toBe(false);
  });
});
