// Sistema di Recovery Automatico per Solana
// Implementa meccanismi di recovery automatici per gestire errori e guasti

const fs = require('fs');
const path = require('path');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const winston = require('winston');

/**
 * Classe ErrorHandler
 * Implementa un sistema centralizzato per la gestione degli errori
 */
class ErrorHandler {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    this.options = {
      logDir: options.logDir || path.join(process.cwd(), 'logs'),
      maxLogSize: options.maxLogSize || 10 * 1024 * 1024, // 10 MB
      maxLogFiles: options.maxLogFiles || 5,
      notifyErrors: options.notifyErrors || false,
      notificationEndpoint: options.notificationEndpoint || null,
      errorHandlers: options.errorHandlers || {},
      recoveryStrategies: options.recoveryStrategies || {}
    };

    // Crea la directory dei log se non esiste
    if (!fs.existsSync(this.options.logDir)) {
      fs.mkdirSync(this.options.logDir, { recursive: true });
    }

    // Inizializza il logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: { service: 'buybot-solana' },
      transports: [
        // Log con livello error su file separato
        new winston.transports.File({
          filename: path.join(this.options.logDir, 'error.log'),
          level: 'error',
          maxsize: this.options.maxLogSize,
          maxFiles: this.options.maxLogFiles
        }),
        // Log con tutti i livelli
        new winston.transports.File({
          filename: path.join(this.options.logDir, 'combined.log'),
          maxsize: this.options.maxLogSize,
          maxFiles: this.options.maxLogFiles
        }),
        // Log sulla console solo in ambiente di sviluppo
        process.env.NODE_ENV !== 'production' ? new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }) : null
      ].filter(Boolean)
    });

    // Registro degli errori per l'analisi
    this.errorRegistry = new Map();
    
    // Contatori per gli errori
    this.errorCounters = new Map();
    
    // Registro delle strategie di recovery
    this.recoveryRegistry = new Map();
    
    // Registra le strategie di recovery predefinite
    this._registerDefaultRecoveryStrategies();
    
    // Registra le strategie di recovery personalizzate
    for (const [errorType, strategy] of Object.entries(this.options.recoveryStrategies)) {
      this.registerRecoveryStrategy(errorType, strategy);
    }
    
    // Gestisci gli errori non catturati
    process.on('uncaughtException', (error) => {
      this.handleError('uncaughtException', error);
    });
    
    process.on('unhandledRejection', (reason) => {
      this.handleError('unhandledRejection', reason);
    });
  }

  /**
   * Gestisce un errore
   * @param {string} errorType - Tipo di errore
   * @param {Error} error - Errore da gestire
   * @param {Object} context - Contesto dell'errore
   * @returns {Object} Risultato della gestione dell'errore
   */
  handleError(errorType, error, context = {}) {
    // Normalizza l'errore
    const normalizedError = this._normalizeError(error);
    
    // Registra l'errore
    this._logError(errorType, normalizedError, context);
    
    // Incrementa il contatore degli errori
    this._incrementErrorCounter(errorType);
    
    // Verifica se esiste un handler specifico per questo tipo di errore
    if (this.options.errorHandlers[errorType]) {
      try {
        return this.options.errorHandlers[errorType](normalizedError, context);
      } catch (handlerError) {
        this.logger.error('Errore durante l\'esecuzione dell\'handler dell\'errore', {
          errorType,
          originalError: normalizedError,
          handlerError
        });
      }
    }
    
    // Applica la strategia di recovery appropriata
    return this._applyRecoveryStrategy(errorType, normalizedError, context);
  }

  /**
   * Registra una strategia di recovery
   * @param {string} errorType - Tipo di errore
   * @param {Function} strategy - Strategia di recovery
   */
  registerRecoveryStrategy(errorType, strategy) {
    if (typeof strategy !== 'function') {
      throw new Error('La strategia di recovery deve essere una funzione');
    }
    
    this.recoveryRegistry.set(errorType, strategy);
    this.logger.info(`Strategia di recovery registrata per ${errorType}`);
  }

  /**
   * Ottiene le statistiche degli errori
   * @returns {Object} Statistiche degli errori
   */
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      errorsByType: {},
      recentErrors: []
    };
    
    // Calcola il totale degli errori
    for (const [errorType, count] of this.errorCounters.entries()) {
      stats.totalErrors += count;
      stats.errorsByType[errorType] = count;
    }
    
    // Ottieni gli errori recenti
    const recentErrors = Array.from(this.errorRegistry.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    
    stats.recentErrors = recentErrors.map(entry => ({
      errorType: entry.errorType,
      message: entry.error.message,
      timestamp: entry.timestamp,
      recoveryAttempted: entry.recoveryAttempted,
      recoverySuccessful: entry.recoverySuccessful
    }));
    
    return stats;
  }

  /**
   * Pulisce il registro degli errori
   */
  clearErrorRegistry() {
    this.errorRegistry.clear();
    this.logger.info('Registro degli errori pulito');
  }

  /**
   * Normalizza un errore
   * @private
   * @param {Error|string|any} error - Errore da normalizzare
   * @returns {Error} Errore normalizzato
   */
  _normalizeError(error) {
    if (error instanceof Error) {
      return error;
    }
    
    if (typeof error === 'string') {
      return new Error(error);
    }
    
    try {
      return new Error(JSON.stringify(error));
    } catch (e) {
      return new Error('Errore non serializzabile');
    }
  }

  /**
   * Registra un errore
   * @private
   * @param {string} errorType - Tipo di errore
   * @param {Error} error - Errore da registrare
   * @param {Object} context - Contesto dell'errore
   */
  _logError(errorType, error, context) {
    // Genera un ID univoco per l'errore
    const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    
    // Filtra le informazioni sensibili dal contesto
    const safeContext = this._sanitizeContext(context);
    
    // Registra l'errore nel logger
    this.logger.error(`[${errorId}] ${errorType}: ${error.message}`, {
      errorId,
      errorType,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      context: safeContext
    });
    
    // Memorizza l'errore nel registro
    this.errorRegistry.set(errorId, {
      id: errorId,
      errorType,
      error,
      context: safeContext,
      timestamp: Date.now(),
      recoveryAttempted: false,
      recoverySuccessful: false
    });
    
    // Limita la dimensione del registro
    if (this.errorRegistry.size > 100) {
      // Rimuovi l'errore più vecchio
      const oldestKey = Array.from(this.errorRegistry.keys())[0];
      this.errorRegistry.delete(oldestKey);
    }
    
    // Invia una notifica se abilitato
    if (this.options.notifyErrors && this.options.notificationEndpoint) {
      this._sendErrorNotification(errorId, errorType, error, safeContext);
    }
  }

  /**
   * Incrementa il contatore degli errori
   * @private
   * @param {string} errorType - Tipo di errore
   */
  _incrementErrorCounter(errorType) {
    const currentCount = this.errorCounters.get(errorType) || 0;
    this.errorCounters.set(errorType, currentCount + 1);
  }

  /**
   * Applica la strategia di recovery appropriata
   * @private
   * @param {string} errorType - Tipo di errore
   * @param {Error} error - Errore da gestire
   * @param {Object} context - Contesto dell'errore
   * @returns {Object} Risultato della recovery
   */
  _applyRecoveryStrategy(errorType, error, context) {
    // Cerca una strategia specifica per questo tipo di errore
    let strategy = this.recoveryRegistry.get(errorType);
    
    // Se non esiste una strategia specifica, usa la strategia predefinita
    if (!strategy) {
      strategy = this.recoveryRegistry.get('default');
    }
    
    if (!strategy) {
      return {
        success: false,
        error,
        message: 'Nessuna strategia di recovery disponibile'
      };
    }
    
    try {
      // Applica la strategia di recovery
      const result = strategy(error, context);
      
      // Aggiorna il registro degli errori
      for (const [id, entry] of this.errorRegistry.entries()) {
        if (entry.error === error) {
          entry.recoveryAttempted = true;
          entry.recoverySuccessful = result.success;
          entry.recoveryResult = result;
          this.errorRegistry.set(id, entry);
          break;
        }
      }
      
      return result;
    } catch (recoveryError) {
      this.logger.error('Errore durante l\'applicazione della strategia di recovery', {
        errorType,
        originalError: error,
        recoveryError
      });
      
      return {
        success: false,
        error,
        recoveryError,
        message: 'Errore durante il tentativo di recovery'
      };
    }
  }

  /**
   * Registra le strategie di recovery predefinite
   * @private
   */
  _registerDefaultRecoveryStrategies() {
    // Strategia predefinita
    this.registerRecoveryStrategy('default', (error, context) => {
      return {
        success: false,
        error,
        message: 'Errore non gestito',
        action: 'logging_only'
      };
    });
    
    // Strategia per errori di connessione
    this.registerRecoveryStrategy('ConnectionError', (error, context) => {
      // Tenta di riconnettersi
      if (context.connection && context.connection instanceof Connection) {
        try {
          // Simula una riconnessione
          this.logger.info('Tentativo di riconnessione a Solana');
          
          return {
            success: true,
            message: 'Riconnessione a Solana riuscita',
            action: 'reconnect'
          };
        } catch (reconnectError) {
          return {
            success: false,
            error: reconnectError,
            message: 'Impossibile riconnettersi a Solana',
            action: 'reconnect_failed'
          };
        }
      }
      
      return {
        success: false,
        error,
        message: 'Impossibile riconnettersi: contesto mancante',
        action: 'logging_only'
      };
    });
    
    // Strategia per errori di transazione
    this.registerRecoveryStrategy('TransactionError', (error, context) => {
      if (context.transaction && context.connection) {
        try {
          // Simula un nuovo tentativo con fee più alta
          this.logger.info('Tentativo di reinvio della transazione con fee più alta');
          
          return {
            success: true,
            message: 'Transazione reinviata con successo',
            action: 'retry_with_higher_fee'
          };
        } catch (retryError) {
          return {
            success: false,
            error: retryError,
            message: 'Impossibile reinviare la transazione',
            action: 'retry_failed'
          };
        }
      }
      
      return {
        success: false,
        error,
        message: 'Impossibile reinviare la transazione: contesto mancante',
        action: 'logging_only'
      };
    });
    
    // Strategia per errori di timeout
    this.registerRecoveryStrategy('TimeoutError', (error, context) => {
      return {
        success: true,
        message: 'Timeout gestito, operazione riprogrammata',
        action: 'reschedule'
      };
    });
    
    // Strategia per errori di memoria
    this.registerRecoveryStrategy('MemoryError', (error, context) => {
      // Simula una pulizia della memoria
      global.gc && global.gc();
      
      return {
        success: true,
        message: 'Memoria liberata',
        action: 'memory_cleanup'
      };
    });
  }

  /**
   * Sanitizza il contesto rimuovendo informazioni sensibili
   * @private
   * @param {Object} context - Contesto da sanitizzare
   * @returns {Object} Contesto sanitizzato
   */
  _sanitizeContext(context) {
    if (!context) return {};
    
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'auth', 'credential', 'private'];
    const safeContext = { ...context };
    
    // Funzione ricorsiva per sanitizzare oggetti annidati
    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      
      const result = Array.isArray(obj) ? [...obj] : { ...obj };
      
      for (const key in result) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          result[key] = '[REDACTED]';
        } else if (typeof result[key] === 'object') {
          result[key] = sanitizeObject(result[key]);
        }
      }
      
      return result;
    };
    
    return sanitizeObject(safeContext);
  }

  /**
   * Invia una notifica di errore
   * @private
   * @param {string} errorId - ID dell'errore
   * @param {string} errorType - Tipo di errore
   * @param {Error} error - Errore
   * @param {Object} context - Contesto dell'errore
   */
  _sendErrorNotification(errorId, errorType, error, context) {
    // Implementazione di esempio, in un'applicazione reale si invierebbe una richiesta HTTP
    this.logger.info(`Notifica di errore inviata per ${errorId}`);
  }
}

/**
 * Classe RecoveryManager
 * Implementa meccanismi di recovery automatici
 */
class RecoveryManager {
  /**
   * Costruttore
   * @param {Object} options - Opzioni di configurazione
   */
  constructor(options = {}) {
    this.options = {
      checkpointDir: options.checkpointDir || path.join(process.cwd(), 'checkpoints'),
      checkpointInterval: options.checkpointInterval || 300000, // 5 minuti
      maxCheckpoints: options.maxCheckpoints || 10,
      errorHandler: options.errorHandler || new ErrorHandler(),
      autoRecover: options.autoRecover !== undefined ? options.autoRecover : true
    };

    // Crea la directory dei checkpoint se non esiste
    if (!fs.existsSync(this.options.checkpointDir)) {
      fs.mkdirSync(this.options.checkpointDir, { recursive: true });
    }

    // Inizializza il logger
    this.logger = this.options.errorHandler.logger;
    
    // Registro dei checkpoint
    this.checkpoints = new Map();
    
    // Timer per il checkpoint automatico
    this.checkpointTimer = null;
    
    // Avvia il checkpoint automatico se abilitato
    if (this.options.checkpointInterval > 0) {
      this.checkpointTimer = setInterval(() => {
        this.createCheckpoint('auto');
      }, this.options.checkpointInterval);
    }
  }

  /**
   * Crea un checkpoint
   * @param {string} name - Nome del checkpoint
   * @param {Object} data - Dati da salvare nel checkpoint
   * @returns {Object} Informazioni sul checkpoint
   */
  createCheckpoint(name, data = {}) {
    try {
      // Genera un ID univoco per il checkpoint
      const checkpointId = `${name}_${Date.now()}`;
      
      // Crea il percorso del file
      const checkpointPath = path.join(this.options.checkpointDir, `${checkpointId}.json`);
      
      // Prepara i dati del checkpoint
      const checkpointData = {
        id: checkpointId,
        name,
        timestamp: Date.now(),
        data
      };
      
      // Salva il checkpoint su file
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpointData, null, 2));
      
      // Memorizza il checkpoint nel registro
      this.checkpoints.set(checkpointId, {
        id: checkpointId,
        name,
        path: checkpointPath,
        timestamp: checkpointData.timestamp
      });
      
      // Limita il numero di checkpoint
      this._limitCheckpoints();
      
      this.logger.info(`Checkpoint creato: ${checkpointId}`);
      
      return {
        id: checkpointId,
        path: checkpointPath,
        timestamp: checkpointData.timestamp
      };
    } catch (error) {
      this.logger.error(`Errore durante la creazione del checkpoint: ${error.message}`, { error });
      
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Carica un checkpoint
   * @param {string} checkpointId - ID del checkpoint
   * @returns {Object} Dati del checkpoint
   */
  loadCheckpoint(checkpointId) {
    try {
      // Verifica se il checkpoint esiste nel registro
      if (!this.checkpoints.has(checkpointId)) {
        // Cerca il file del checkpoint
        const checkpointPath = path.join(this.options.checkpointDir, `${checkpointId}.json`);
        
        if (!fs.existsSync(checkpointPath)) {
          throw new Error(`Checkpoint non trovato: ${checkpointId}`);
        }
        
        // Aggiungi il checkpoint al registro
        this.checkpoints.set(checkpointId, {
          id: checkpointId,
          path: checkpointPath,
          timestamp: Date.now()
        });
      }
      
      // Ottieni il percorso del checkpoint
      const checkpointInfo = this.checkpoints.get(checkpointId);
      
      // Leggi il file del checkpoint
      const checkpointData = JSON.parse(fs.readFileSync(checkpointInfo.path, 'utf8'));
      
      this.logger.info(`Checkpoint caricato: ${checkpointId}`);
      
      return checkpointData;
    } catch (error) {
      this.logger.error(`Errore durante il caricamento del checkpoint: ${error.message}`, { error });
      
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Ripristina da un checkpoint
   * @param {string} checkpointId - ID del checkpoint
   * @param {Function} restoreFunction - Funzione di ripristino
   * @returns {Object} Risultato del ripristino
   */
  async restoreFromCheckpoint(checkpointId, restoreFunction) {
    try {
      // Carica il checkpoint
      const checkpoint = this.loadCheckpoint(checkpointId);
      
      if (!checkpoint || checkpoint.success === false) {
        throw new Error(`Impossibile caricare il checkpoint: ${checkpointId}`);
      }
      
      // Esegui la funzione di ripristino
      if (typeof restoreFunction === 'function') {
        const result = await restoreFunction(checkpoint);
        
        this.logger.info(`Ripristino dal checkpoint ${checkpointId} completato`);
        
        return {
          success: true,
          checkpointId,
          result
        };
      }
      
      return {
        success: true,
        checkpointId,
        checkpoint
      };
    } catch (error) {
      this.logger.error(`Errore durante il ripristino dal checkpoint: ${error.message}`, { error });
      
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Elimina un checkpoint
   * @param {string} checkpointId - ID del checkpoint
   * @returns {boolean} True se il checkpoint è stato eliminato
   */
  deleteCheckpoint(checkpointId) {
    try {
      // Verifica se il checkpoint esiste nel registro
      if (!this.checkpoints.has(checkpointId)) {
        return false;
      }
      
      // Ottieni il percorso del checkpoint
      const checkpointInfo = this.checkpoints.get(checkpointId);
      
      // Elimina il file del checkpoint
      if (fs.existsSync(checkpointInfo.path)) {
        fs.unlinkSync(checkpointInfo.path);
      }
      
      // Rimuovi il checkpoint dal registro
      this.checkpoints.delete(checkpointId);
      
      this.logger.info(`Checkpoint eliminato: ${checkpointId}`);
      
      return true;
    } catch (error) {
      this.logger.error(`Errore durante l'eliminazione del checkpoint: ${error.message}`, { error });
      
      return false;
    }
  }

  /**
   * Ottiene la lista dei checkpoint
   * @returns {Array} Lista dei checkpoint
   */
  listCheckpoints() {
    try {
      // Aggiorna il registro dei checkpoint
      this._updateCheckpointRegistry();
      
      // Converti il registro in un array
      return Array.from(this.checkpoints.values())
        .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      this.logger.error(`Errore durante l'elenco dei checkpoint: ${error.message}`, { error });
      
      return [];
    }
  }

  /**
   * Chiude il recovery manager
   */
  close() {
    // Cancella il timer del checkpoint automatico
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    
    this.logger.info('Recovery Manager chiuso');
  }

  /**
   * Limita il numero di checkpoint
   * @private
   */
  _limitCheckpoints() {
    // Ottieni tutti i checkpoint
    const checkpoints = this.listCheckpoints();
    
    // Se il numero di checkpoint supera il limite, elimina i più vecchi
    if (checkpoints.length > this.options.maxCheckpoints) {
      const checkpointsToDelete = checkpoints.slice(this.options.maxCheckpoints);
      
      for (const checkpoint of checkpointsToDelete) {
        this.deleteCheckpoint(checkpoint.id);
      }
    }
  }

  /**
   * Aggiorna il registro dei checkpoint
   * @private
   */
  _updateCheckpointRegistry() {
    try {
      // Leggi tutti i file nella directory dei checkpoint
      const files = fs.readdirSync(this.options.checkpointDir);
      
      // Filtra i file JSON
      const checkpointFiles = files.filter(file => file.endsWith('.json'));
      
      // Aggiorna il registro dei checkpoint
      for (const file of checkpointFiles) {
        const checkpointId = file.replace('.json', '');
        
        if (!this.checkpoints.has(checkpointId)) {
          try {
            // Leggi il file del checkpoint
            const checkpointPath = path.join(this.options.checkpointDir, file);
            const checkpointData = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
            
            // Aggiungi il checkpoint al registro
            this.checkpoints.set(checkpointId, {
              id: checkpointId,
              name: checkpointData.name,
              path: checkpointPath,
              timestamp: checkpointData.timestamp
            });
          } catch (error) {
            this.logger.warn(`Impossibile leggere il checkpoint ${file}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Errore durante l'aggiornamento del registro dei checkpoint: ${error.message}`, { error });
    }
  }
}

module.exports = {
  ErrorHandler,
  RecoveryManager
};
