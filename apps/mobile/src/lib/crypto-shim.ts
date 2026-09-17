import * as ExpoCrypto from 'expo-crypto';

/**
 * Hermes ships no global `crypto`, and `@unigate/api-client` derives `Idempotency-Key` values
 * from `crypto.getRandomValues` / `crypto.randomUUID`. Without this shim every mutating call
 * (create request, bid, pay, upload) failed before leaving the device and surfaced as "cannot
 * reach the server". Imported first from the root layout so it runs before any screen module.
 */
type GetRandomValues = <T extends ArrayBufferView | null>(array: T) => T;

export interface CryptoLike {
  getRandomValues?: GetRandomValues | undefined;
  randomUUID?: (() => string) | undefined;
}

const expoGetRandomValues = ExpoCrypto.getRandomValues as GetRandomValues;
const expoRandomUUID = (): string => ExpoCrypto.randomUUID();

export function installCryptoShim(target: { crypto?: CryptoLike | undefined } = globalThis as { crypto?: CryptoLike }): CryptoLike {
  const existing = target.crypto;
  if (!existing || typeof existing.getRandomValues !== 'function') {
    const shim: CryptoLike = { ...(existing ?? {}), getRandomValues: expoGetRandomValues, randomUUID: expoRandomUUID };
    target.crypto = shim;
    return shim;
  }
  if (typeof existing.randomUUID !== 'function') existing.randomUUID = expoRandomUUID;
  return existing;
}

installCryptoShim();
