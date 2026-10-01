// src/ai/security/SecureVault.ts
//! High-level client for the Windows DPAPI secure vault.
//! Ensures secrets are NEVER stored in localStorage, state, or git repositories.

import { IPlatformBridge } from '../../platform/IPlatformBridge';
import { defaultPlatformBridge } from '../../platform';

export class SecureVault {
  constructor(private bridge: IPlatformBridge = defaultPlatformBridge) {}

  /**
   * Stores an encrypted API key for a specific provider in the Windows DPAPI vault.
   */
  async setProviderSecret(providerId: string, secret: string): Promise<void> {
    if (!secret || secret.trim() === '') {
      await this.deleteProviderSecret(providerId);
      return;
    }
    const keyId = `provider_secret_${providerId}`;
    await this.bridge.saveSecureSecret(keyId, secret.trim());
  }

  /**
   * Retrieves decrypted API key strictly inside internal provider callers.
   */
  async getProviderSecret(providerId: string): Promise<string | null> {
    const keyId = `provider_secret_${providerId}`;
    return await this.bridge.getSecureSecret(keyId);
  }

  /**
   * Checks if an API key exists in the vault without reading its plaintext value.
   */
  async hasProviderSecret(providerId: string): Promise<boolean> {
    const keyId = `provider_secret_${providerId}`;
    return await this.bridge.hasSecureSecret(keyId);
  }

  /**
   * Removes secret from the secure vault.
   */
  async deleteProviderSecret(providerId: string): Promise<boolean> {
    const keyId = `provider_secret_${providerId}`;
    return await this.bridge.deleteSecureSecret(keyId);
  }
}

export const defaultSecureVault = new SecureVault();
