// Configuration management utility
class ConfigManager {
  static async validateSettings(settings) {
    const errors = [];
    
    if (settings.redmineUrl) {
      if (!this.isValidUrl(settings.redmineUrl)) {
        errors.push('Invalid Redmine URL format');
      }
    }
    
    if (settings.checkInterval && (settings.checkInterval < 1 || settings.checkInterval > 1440)) {
      errors.push('Check interval must be between 1 and 1440 minutes');
    }
    
    if (settings.maxNotifications && (settings.maxNotifications < 1 || settings.maxNotifications > 1000)) {
      errors.push('Max notifications must be between 1 and 1000');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  static isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      // Allow both HTTP and HTTPS protocols
      // Note: HTTP is not recommended for production due to security concerns
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  static sanitizeConfig(config) {
    const sanitized = {};
    
    // Only allow known configuration keys
    const allowedKeys = [
      'redmineUrl', 'apiKey', 'checkInterval', 'enableNotifications',
      'enableSound', 'maxNotifications', 'language', 'onlyMyProjects',
      'includeWatchedIssues'
    ];
    
    for (const key of allowedKeys) {
      if (config.hasOwnProperty(key)) {
        sanitized[key] = config[key];
      }
    }
    
    return sanitized;
  }
}

// Encryption utility for API key security
class EncryptionUtils {
  // Enhanced encryption for browser storage
  static async encrypt(text) {
    if (!text) return '';
    
    try {
      // Use Web Crypto API if available
      if (window.crypto && window.crypto.subtle) {
        return await this.encryptWithWebCrypto(text);
      } else {
        // Fallback to simple encryption
        return await this.encryptSimple(text);
      }
    } catch (error) {
      console.error('Encryption failed:', error);
      return text; // Fallback to unencrypted if encryption fails
    }
  }
  
  static async decrypt(encryptedText) {
    if (!encryptedText) return '';
    
    try {
      // Try Web Crypto API first
      if (window.crypto && window.crypto.subtle && encryptedText.startsWith('wc:')) {
        return await this.decryptWithWebCrypto(encryptedText.substring(3));
      } else {
        // Fallback to simple decryption
        return await this.decryptSimple(encryptedText);
      }
    } catch (error) {
      console.error('Decryption failed:', error);
      return encryptedText; // Fallback to treating as unencrypted
    }
  }

  // Web Crypto API implementation
  static async encryptWithWebCrypto(text) {
    const key = await this.getOrCreateCryptoKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    
    // Generate random IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    
    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return 'wc:' + btoa(String.fromCharCode(...combined));
  }

  static async decryptWithWebCrypto(encryptedData) {
    const key = await this.getOrCreateCryptoKey();
    
    // Decode and separate IV and data
    const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  static async getOrCreateCryptoKey() {
    // Get or generate key material
    const keyMaterial = await this.getOrCreateKeyMaterial();
    
    // Import key
    return await window.crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async getOrCreateKeyMaterial() {
    let result = await chrome.storage.local.get(['cryptoKeyMaterial']);
    
    if (result.cryptoKeyMaterial) {
      return new Uint8Array(result.cryptoKeyMaterial);
    }
    
    // Generate new key material
    const keyMaterial = window.crypto.getRandomValues(new Uint8Array(32));
    await chrome.storage.local.set({ cryptoKeyMaterial: Array.from(keyMaterial) });
    return keyMaterial;
  }

  // Simple encryption fallback
  static async encryptSimple(text) {
    const key = await this.getOrCreateKey();
    
    // Simple XOR encryption with base64 encoding
    let encrypted = '';
    for (let i = 0; i < text.length; i++) {
      encrypted += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    
    return btoa(encrypted);
  }
  
  static async decryptSimple(encryptedText) {
    const key = await this.getOrCreateKey();
    
    // Decode from base64 and decrypt
    const encrypted = atob(encryptedText);
    let decrypted = '';
    for (let i = 0; i < encrypted.length; i++) {
      decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    
    return decrypted;
  }
  
  static async getOrCreateKey() {
    // First try to get from local storage
    let result = await chrome.storage.local.get(['encryptionKey']);
    
    if (result.encryptionKey) {
      return result.encryptionKey;
    }
    
    // If not found, try to get from sync storage (for cross-device sync)
    result = await chrome.storage.sync.get(['encryptionKey']);
    
    if (result.encryptionKey) {
      // Store in local storage for faster access
      await chrome.storage.local.set({ encryptionKey: result.encryptionKey });
      return result.encryptionKey;
    }
    
    // Generate a new key with better entropy
    const key = this.generateSecureKey();
    
    // Store in both local and sync storage
    await chrome.storage.local.set({ encryptionKey: key });
    await chrome.storage.sync.set({ encryptionKey: key });
    return key;
  }

  static generateSecureKey() {
    // Generate more secure key using crypto API if available
    if (window.crypto && window.crypto.getRandomValues) {
      const array = new Uint8Array(32);
      window.crypto.getRandomValues(array);
      return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    } else {
      // Fallback for older browsers
      return Math.random().toString(36).substring(2, 15) + 
             Math.random().toString(36).substring(2, 15) +
             Date.now().toString(36);
    }
  }
}

// Export for use in options page
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConfigManager, EncryptionUtils };
} else {
  window.ConfigManager = ConfigManager;
  window.EncryptionUtils = EncryptionUtils;
}
