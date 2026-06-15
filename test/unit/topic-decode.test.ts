import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';

/**
 * Guards the event-signature decoding the listener relies on. These topic hashes and the
 * address/amount extraction are the contract between raw logs and typed events; if an
 * ethers upgrade or a typo changed them, ingestion would silently misclassify events.
 */
describe('event topic signatures', () => {
  it('computes the canonical ERC-20/721 Transfer topic', () => {
    expect(ethers.id('Transfer(address,address,uint256)')).toBe(
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    );
  });

  it('distinguishes ERC-1155 single vs batch', () => {
    const single = ethers.id('TransferSingle(address,address,address,uint256,uint256)');
    const batch = ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
    expect(single).not.toBe(batch);
    expect(single).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('decodes an indexed address from a 32-byte topic the way the listener does', () => {
    // topics[1] is a left-padded address; the listener slices the last 20 bytes.
    const addr = '0x000000000000000000000000abcdef0123456789abcdef0123456789abcdef01';
    const decoded = ethers.getAddress('0x' + addr.slice(26)).toLowerCase();
    expect(decoded).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
  });

  it('decodes a uint256 amount from log data', () => {
    const amount = ethers.toBigInt('0x0000000000000000000000000000000000000000000000000de0b6b3a7640000');
    expect(amount.toString()).toBe('1000000000000000000'); // 1e18
  });

  it('decodes ERC-1155 TransferSingle data (id, value)', () => {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [42n, 5n]);
    const [id, value] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], encoded);
    expect(id.toString()).toBe('42');
    expect(value.toString()).toBe('5');
  });
});
