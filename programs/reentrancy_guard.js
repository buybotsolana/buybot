// Modulo di protezione contro attacchi di reentrancy
// Questo modulo implementa un meccanismo di protezione contro attacchi di reentrancy

/**
 * Classe ReentrancyGuard
 * Implementa un meccanismo di protezione contro attacchi di reentrancy
 */
class ReentrancyGuard {
  /**
   * Costruttore
   */
  constructor() {
    this.locks = new Map();
    this.pendingOperations = new Map();
    this.operationLog = [];
    this.maxLogSize = 1000;
  }

  /**
   * Esegue una funzione con protezione contro reentrancy
   * @param {string} operationId - Identificatore univoco dell'operazione
   * @param {Function} fn - Funzione da eseguire
   * @param {Object} context - Contesto per l'esecuzione della funzione
   * @param {Array} args - Argomenti per la funzione
   * @returns {Promise<any>} Risultato della funzione
   */
  async executeWithGuard(operationId, fn, context = null, ...args) {
    if (!operationId || typeof operationId !== 'string') {
      throw new Error('OperationId deve essere una stringa non vuota');
    }

    if (typeof fn !== 'function') {
      throw new Error('Fn deve essere una funzione');
    }

    // Verifica se l'operazione è già in esecuzione
    if (this.isLocked(operationId)) {
      console.warn(`Tentativo di rientranza rilevato per l'operazione: ${operationId}`);
      
      // Registra il tentativo di rientranza
      this._logOperation(operationId, 'reentrancy_attempt', {
        timestamp: Date.now(),
        args: args
      });
      
      // Aggiungi alla coda delle operazioni in attesa
      return this._addToPendingQueue(operationId, fn, context, args);
    }

    // Acquisisci il lock
    this._lock(operationId);

    try {
      // Registra l'inizio dell'operazione
      this._logOperation(operationId, 'start', {
        timestamp: Date.now()
      });

      // Esegui la funzione
      const result = await fn.apply(context, args);

      // Registra il completamento dell'operazione
      this._logOperation(operationId, 'complete', {
        timestamp: Date.now(),
        success: true
      });

      return result;
    } catch (error) {
      // Registra l'errore
      this._logOperation(operationId, 'error', {
        timestamp: Date.now(),
        error: error.message,
        stack: error.stack
      });

      throw error;
    } finally {
      // Rilascia il lock
      this._unlock(operationId);

      // Esegui le operazioni in attesa
      this._processPendingOperations(operationId);
    }
  }

  /**
   * Verifica se un'operazione è bloccata
   * @param {string} operationId - Identificatore dell'operazione
   * @returns {boolean} True se l'operazione è bloccata
   */
  isLocked(operationId) {
    return this.locks.has(operationId) && this.locks.get(operationId);
  }

  /**
   * Ottiene il log delle operazioni
   * @returns {Array} Log delle operazioni
   */
  getOperationLog() {
    return [...this.operationLog];
  }

  /**
   * Blocca un'operazione
   * @private
   * @param {string} operationId - Identificatore dell'operazione
   */
  _lock(operationId) {
    this.locks.set(operationId, true);
  }

  /**
   * Sblocca un'operazione
   * @private
   * @param {string} operationId - Identificatore dell'operazione
   */
  _unlock(operationId) {
    this.locks.set(operationId, false);
  }

  /**
   * Aggiunge un'operazione alla coda delle operazioni in attesa
   * @private
   * @param {string} operationId - Identificatore dell'operazione
   * @param {Function} fn - Funzione da eseguire
   * @param {Object} context - Contesto per l'esecuzione della funzione
   * @param {Array} args - Argomenti per la funzione
   * @returns {Promise<any>} Promise che si risolve con il risultato dell'operazione
   */
  _addToPendingQueue(operationId, fn, context, args) {
    return new Promise((resolve, reject) => {
      if (!this.pendingOperations.has(operationId)) {
        this.pendingOperations.set(operationId, []);
      }

      this.pendingOperations.get(operationId).push({
        fn,
        context,
        args,
        resolve,
        reject,
        timestamp: Date.now()
      });
    });
  }

  /**
   * Elabora le operazioni in attesa
   * @private
   * @param {string} operationId - Identificatore dell'operazione
   */
  async _processPendingOperations(operationId) {
    if (!this.pendingOperations.has(operationId)) {
      return;
    }

    const pendingOps = this.pendingOperations.get(operationId);
    if (pendingOps.length === 0) {
      return;
    }

    // Prendi la prima operazione in attesa
    const nextOp = pendingOps.shift();

    // Se non ci sono più operazioni in attesa, rimuovi la coda
    if (pendingOps.length === 0) {
      this.pendingOperations.delete(operationId);
    }

    try {
      // Esegui l'operazione con protezione contro reentrancy
      const result = await this.executeWithGuard(
        operationId,
        nextOp.fn,
        nextOp.context,
        ...nextOp.args
      );

      // Risolvi la promise
      nextOp.resolve(result);
    } catch (error) {
      // Rifiuta la promise in caso di errore
      nextOp.reject(error);
    }
  }

  /**
   * Registra un'operazione nel log
   * @private
   * @param {string} operationId - Identificatore dell'operazione
   * @param {string} status - Stato dell'operazione
   * @param {Object} details - Dettagli dell'operazione
   */
  _logOperation(operationId, status, details) {
    this.operationLog.push({
      operationId,
      status,
      ...details
    });

    // Limita la dimensione del log
    if (this.operationLog.length > this.maxLogSize) {
      this.operationLog = this.operationLog.slice(-this.maxLogSize);
    }
  }
}

module.exports = ReentrancyGuard;
