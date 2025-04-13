// Implementazione di verifica delle firme reale per Solana
// Questo modulo sostituisce la simulazione con una verifica crittografica reale

const { PublicKey, Transaction } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58');

/**
 * Classe SignatureVerifier
 * Implementa una verifica reale delle firme per le transazioni Solana
 */
class SignatureVerifier {
  /**
   * Costruttore
   */
  constructor() {
    this.verificationCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minuti
    this.lastCacheCleanup = Date.now();
  }

  /**
   * Verifica una firma
   * @param {string|Buffer} message - Messaggio firmato
   * @param {string|Buffer} signature - Firma da verificare
   * @param {string|PublicKey} publicKey - Chiave pubblica del firmatario
   * @returns {boolean} True se la firma è valida
   */
  verifySignature(message, signature, publicKey) {
    if (!message || !signature || !publicKey) {
      throw new Error('Message, signature e publicKey sono obbligatori');
    }

    // Normalizza gli input
    const messageBuffer = this._normalizeToBuffer(message);
    const signatureBuffer = this._normalizeToBuffer(signature);
    const publicKeyObj = this._normalizeToPublicKey(publicKey);

    // Crea una chiave di cache
    const cacheKey = this._createCacheKey(messageBuffer, signatureBuffer, publicKeyObj);

    // Verifica se la firma è nella cache
    if (this.verificationCache.has(cacheKey)) {
      const cachedResult = this.verificationCache.get(cacheKey);
      if (Date.now() - cachedResult.timestamp < this.cacheTimeout) {
        return cachedResult.isValid;
      }
      // Rimuovi la cache scaduta
      this.verificationCache.delete(cacheKey);
    }

    // Pulisci la cache se necessario
    this._cleanupCache();

    // Verifica la firma utilizzando tweetnacl
    const publicKeyBytes = publicKeyObj.toBytes();
    const isValid = nacl.sign.detached.verify(
      messageBuffer,
      signatureBuffer,
      publicKeyBytes
    );

    // Aggiungi il risultato alla cache
    this.verificationCache.set(cacheKey, {
      isValid,
      timestamp: Date.now()
    });

    return isValid;
  }

  /**
   * Verifica una transazione Solana
   * @param {Transaction} transaction - Transazione da verificare
   * @returns {boolean} True se tutte le firme nella transazione sono valide
   */
  verifyTransaction(transaction) {
    if (!transaction) {
      throw new Error('Transaction è obbligatoria');
    }

    // Verifica che la transazione abbia firme
    if (!transaction.signatures || transaction.signatures.length === 0) {
      return false;
    }

    try {
      // Ottieni il messaggio della transazione
      const message = transaction.serializeMessage();

      // Verifica ogni firma
      for (const sigPair of transaction.signatures) {
        if (!sigPair.signature) {
          continue; // Salta le firme nulle
        }

        const publicKey = sigPair.publicKey;
        const signature = sigPair.signature;

        // Verifica la firma
        const isValid = this.verifySignature(message, signature, publicKey);
        if (!isValid) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Errore durante la verifica della transazione:', error);
      return false;
    }
  }

  /**
   * Normalizza un input in un Buffer
   * @private
   * @param {string|Buffer} input - Input da normalizzare
   * @returns {Buffer} Input normalizzato come Buffer
   */
  _normalizeToBuffer(input) {
    if (Buffer.isBuffer(input)) {
      return input;
    }

    if (typeof input === 'string') {
      try {
        // Prova a decodificare come base58
        return Buffer.from(bs58.decode(input));
      } catch (error) {
        // Se non è base58, trattalo come una stringa UTF-8
        return Buffer.from(input, 'utf8');
      }
    }

    if (input instanceof Uint8Array) {
      return Buffer.from(input);
    }

    throw new Error('Input deve essere un Buffer, una stringa o un Uint8Array');
  }

  /**
   * Normalizza un input in una PublicKey
   * @private
   * @param {string|PublicKey} publicKey - Chiave pubblica da normalizzare
   * @returns {PublicKey} Chiave pubblica normalizzata
   */
  _normalizeToPublicKey(publicKey) {
    if (publicKey instanceof PublicKey) {
      return publicKey;
    }

    if (typeof publicKey === 'string') {
      return new PublicKey(publicKey);
    }

    throw new Error('PublicKey deve essere una stringa o un oggetto PublicKey');
  }

  /**
   * Crea una chiave di cache
   * @private
   * @param {Buffer} message - Messaggio
   * @param {Buffer} signature - Firma
   * @param {PublicKey} publicKey - Chiave pubblica
   * @returns {string} Chiave di cache
   */
  _createCacheKey(message, signature, publicKey) {
    return `${message.toString('hex')}-${signature.toString('hex')}-${publicKey.toString()}`;
  }

  /**
   * Pulisce la cache delle verifiche
   * @private
   */
  _cleanupCache() {
    const now = Date.now();

    // Pulisci la cache solo ogni minuto
    if (now - this.lastCacheCleanup < 60000) {
      return;
    }

    this.lastCacheCleanup = now;

    // Rimuovi le verifiche scadute dalla cache
    for (const [key, value] of this.verificationCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.verificationCache.delete(key);
      }
    }
  }
}

module.exports = SignatureVerifier;
