// Lock Liquidity Program per Solana
// Questo programma blocca la liquidità per periodi prestabiliti

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configurazione
const LOCK_PERIODS = {
  SIX_MONTHS: 6 * 30 * 24 * 60 * 60 * 1000, // 6 mesi in millisecondi
  ONE_YEAR: 12 * 30 * 24 * 60 * 60 * 1000,  // 1 anno in millisecondi
  THREE_YEARS: 3 * 12 * 30 * 24 * 60 * 60 * 1000, // 3 anni in millisecondi
  FIVE_YEARS: 5 * 12 * 30 * 24 * 60 * 60 * 1000   // 5 anni in millisecondi
};

// Incentivi per il lock della liquidità
const LOCK_INCENTIVES = {
  SIX_MONTHS: 5,  // 5% di bonus token
  ONE_YEAR: 15,   // 15% di bonus token
  THREE_YEARS: 40, // 40% di bonus token
  FIVE_YEARS: 100  // 100% di bonus token (raddoppio)
};

// Limiti di configurazione
const MAX_LOCK_AMOUNT = 1000000000; // Limite massimo per l'importo di un singolo lock
const MIN_LOCK_AMOUNT = 1000; // Importo minimo per un lock
const MAX_LOCKS_PER_PROVIDER = 10; // Numero massimo di lock attivi per provider

// Funzione sicura per le operazioni aritmetiche
function safeArithmetic() {
  // Funzione per somma sicura
  const safeAdd = (a, b) => {
    const result = a + b;
    // Verifica overflow
    if (result < a || result < b) {
      console.warn('Rilevato potenziale overflow nella somma, limitando il risultato');
      return Number.MAX_SAFE_INTEGER;
    }
    return result;
  };

  // Funzione per moltiplicazione sicura
  const safeMultiply = (a, b) => {
    // Se uno dei fattori è 0, il risultato è 0 (nessun rischio di overflow)
    if (a === 0 || b === 0) return 0;
    
    const result = a * b;
    // Verifica overflow
    if (result / a !== b || result / b !== a) {
      console.warn('Rilevato potenziale overflow nella moltiplicazione, limitando il risultato');
      return Number.MAX_SAFE_INTEGER;
    }
    return result;
  };

  // Funzione per divisione sicura
  const safeDivide = (a, b) => {
    // Verifica divisione per zero
    if (b === 0) {
      console.warn('Tentativo di divisione per zero, restituendo 0');
      return 0;
    }
    return a / b;
  };

  // Funzione per limitare un valore in un intervallo
  const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
  };

  return {
    add: safeAdd,
    multiply: safeMultiply,
    divide: safeDivide,
    clamp
  };
}

class LockLiquidity {
  constructor(connection, tokenAddress) {
    // Validazione degli input nel costruttore
    if (!connection) {
      throw new Error('Connection non può essere null o undefined');
    }
    
    try {
      // Verifica che tokenAddress sia una PublicKey valida
      this.tokenAddress = new PublicKey(tokenAddress);
    } catch (error) {
      throw new Error(`Indirizzo token non valido: ${error.message}`);
    }
    
    this.connection = connection;
    this.lockedLiquidity = [];
    this.math = safeArithmetic(); // Inizializza le funzioni aritmetiche sicure
    this.errorLog = []; // Log degli errori per tracciamento e debug
  }

  // Registra un errore nel log
  logError(operation, error, metadata = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      operation,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack
      } : error,
      metadata
    };
    
    console.error(`Errore in ${operation}: ${error.message || error}`);
    this.errorLog.push(errorEntry);
    
    // Limita la dimensione del log degli errori
    if (this.errorLog.length > 100) {
      this.errorLog = this.errorLog.slice(-100);
    }
    
    return errorEntry;
  }

  // Verifica se un provider ha raggiunto il limite di lock
  hasReachedLockLimit(liquidityProvider) {
    try {
      const providerAddress = liquidityProvider.toString();
      const activeLocks = this.lockedLiquidity.filter(
        lock => lock.liquidityProvider === providerAddress && lock.status === 'LOCKED'
      );
      
      return activeLocks.length >= MAX_LOCKS_PER_PROVIDER;
    } catch (error) {
      this.logError('hasReachedLockLimit', error, { liquidityProvider });
      return true; // In caso di errore, assumiamo che il limite sia stato raggiunto per sicurezza
    }
  }

  // Blocca la liquidità per un periodo specifico
  async lockLiquidity(liquidityProvider, amount, lockPeriod) {
    try {
      // Validazione degli input
      if (!liquidityProvider) {
        throw new Error('liquidityProvider non può essere null o undefined');
      }
      
      let providerPubkey;
      try {
        // Verifica che liquidityProvider sia una PublicKey valida
        providerPubkey = new PublicKey(liquidityProvider);
      } catch (error) {
        throw new Error(`Indirizzo liquidityProvider non valido: ${error.message}`);
      }
      
      // Verifica che amount sia un numero positivo e nei limiti
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        throw new Error('amount deve essere un numero positivo');
      }
      
      if (amount < MIN_LOCK_AMOUNT) {
        throw new Error(`amount inferiore al minimo consentito (${MIN_LOCK_AMOUNT})`);
      }
      
      if (amount > MAX_LOCK_AMOUNT) {
        throw new Error(`amount superiore al massimo consentito (${MAX_LOCK_AMOUNT})`);
      }
      
      // Verifica che il periodo di lock sia valido
      if (!Object.values(LOCK_PERIODS).includes(lockPeriod)) {
        throw new Error('Periodo di lock non valido');
      }
      
      // Verifica che il provider non abbia raggiunto il limite di lock
      if (this.hasReachedLockLimit(providerPubkey)) {
        throw new Error(`Limite di ${MAX_LOCKS_PER_PROVIDER} lock attivi per provider raggiunto`);
      }
      
      console.log(`Blocco di ${amount} token di liquidità per ${lockPeriod / (30 * 24 * 60 * 60 * 1000)} mesi`);
      
      // Calcola l'incentivo
      let incentivePercentage = 0;
      let periodName = '';
      
      if (lockPeriod === LOCK_PERIODS.SIX_MONTHS) {
        incentivePercentage = LOCK_INCENTIVES.SIX_MONTHS;
        periodName = 'SIX_MONTHS';
      } else if (lockPeriod === LOCK_PERIODS.ONE_YEAR) {
        incentivePercentage = LOCK_INCENTIVES.ONE_YEAR;
        periodName = 'ONE_YEAR';
      } else if (lockPeriod === LOCK_PERIODS.THREE_YEARS) {
        incentivePercentage = LOCK_INCENTIVES.THREE_YEARS;
        periodName = 'THREE_YEARS';
      } else if (lockPeriod === LOCK_PERIODS.FIVE_YEARS) {
        incentivePercentage = LOCK_INCENTIVES.FIVE_YEARS;
        periodName = 'FIVE_YEARS';
      }
      
      // Calcolo sicuro dell'incentivo
      const incentiveAmount = this.math.clamp(
        Math.floor(this.math.multiply(amount, this.math.divide(incentivePercentage, 100))),
        0,
        Number.MAX_SAFE_INTEGER
      );
      
      const now = new Date();
      const unlockDate = new Date(now.getTime() + lockPeriod);
      
      // Crea un record per la liquidità bloccata
      const lockRecord = {
        id: `lock_${Date.now()}_${providerPubkey.toString().substring(0, 8)}`,
        liquidityProvider: providerPubkey.toString(),
        amount,
        lockPeriod,
        periodName,
        incentivePercentage,
        incentiveAmount,
        lockDate: now.toISOString(),
        unlockDate: unlockDate.toISOString(),
        status: 'LOCKED',
        transactions: [{
          type: 'LOCK',
          timestamp: now.toISOString(),
          amount,
          incentiveAmount
        }]
      };
      
      // In un'implementazione reale, qui trasferiremmo i token in un account di escrow
      // e distribuiremmo gli incentivi al provider di liquidità
      try {
        // Simulazione di trasferimento token (in un'implementazione reale, questo sarebbe un trasferimento effettivo)
        console.log(`Trasferimento di ${amount} token da ${providerPubkey.toString()} all'account di escrow`);
        console.log(`Distribuzione di ${incentiveAmount} token di incentivo a ${providerPubkey.toString()}`);
        
        // Aggiungi il record alla lista
        this.lockedLiquidity.push(lockRecord);
        
        console.log(`Liquidità bloccata con successo fino a ${unlockDate.toLocaleDateString()}`);
        console.log(`Incentivo: ${incentiveAmount} token (${incentivePercentage}%)`);
        
        return lockRecord;
      } catch (transferError) {
        // Gestione dell'errore durante il trasferimento
        this.logError('lockLiquidity_transfer', transferError, { 
          liquidityProvider: providerPubkey.toString(), 
          amount, 
          lockPeriod 
        });
        
        throw new Error(`Errore durante il trasferimento dei token: ${transferError.message}`);
      }
    } catch (error) {
      // Gestione dell'errore generale
      this.logError('lockLiquidity', error, { 
        liquidityProvider: liquidityProvider?.toString(), 
        amount, 
        lockPeriod 
      });
      
      throw error; // Rilancia l'errore per gestione esterna
    }
  }
  
  // Sblocca la liquidità se il periodo è terminato
  async unlockLiquidity(lockId, requestor) {
    try {
      // Validazione degli input
      if (!lockId || typeof lockId !== 'string') {
        throw new Error('lockId non valido');
      }
      
      let requestorPubkey;
      if (requestor) {
        try {
          // Verifica che requestor sia una PublicKey valida
          requestorPubkey = new PublicKey(requestor);
        } catch (error) {
          throw new Error(`Indirizzo requestor non valido: ${error.message}`);
        }
      }
      
      console.log(`Tentativo di sblocco della liquidità con ID: ${lockId}`);
      
      // Trova il record di lock
      const lockIndex = this.lockedLiquidity.findIndex(lock => lock.id === lockId);
      
      if (lockIndex === -1) {
        throw new Error(`Lock non trovato con ID: ${lockId}`);
      }
      
      const lock = this.lockedLiquidity[lockIndex];
      
      // Verifica che il richiedente sia il proprietario del lock
      if (requestorPubkey && lock.liquidityProvider !== requestorPubkey.toString()) {
        throw new Error('Non autorizzato: solo il provider di liquidità può sbloccare i propri lock');
      }
      
      // Verifica se il lock è già stato sbloccato
      if (lock.status === 'UNLOCKED') {
        throw new Error('Questo lock è già stato sbloccato');
      }
      
      // Verifica se il periodo di lock è terminato
      const unlockDate = new Date(lock.unlockDate);
      const now = new Date();
      
      if (now < unlockDate) {
        const remainingTime = unlockDate.getTime() - now.getTime();
        const remainingDays = Math.ceil(remainingTime / (24 * 60 * 60 * 1000));
        
        console.log(`La liquidità è ancora bloccata per altri ${remainingDays} giorni`);
        throw new Error(`La liquidità è ancora bloccata fino a ${unlockDate.toLocaleDateString()}`);
      }
      
      // In un'implementazione reale, qui trasferiremmo i token dall'account di escrow
      // al provider di liquidità
      try {
        // Simulazione di trasferimento token (in un'implementazione reale, questo sarebbe un trasferimento effettivo)
        console.log(`Trasferimento di ${lock.amount} token dall'account di escrow a ${lock.liquidityProvider}`);
        
        // Aggiorna lo stato del lock
        lock.status = 'UNLOCKED';
        lock.unlockExecutionDate = now.toISOString();
        
        // Aggiungi la transazione alla storia del lock
        lock.transactions.push({
          type: 'UNLOCK',
          timestamp: now.toISOString(),
          amount: lock.amount
        });
        
        console.log(`Liquidità sbloccata con successo: ${lock.amount} token`);
        
        return lock;
      } catch (transferError) {
        // Gestione dell'errore durante il trasferimento
        this.logError('unlockLiquidity_transfer', transferError, { lockId });
        
        throw new Error(`Errore durante il trasferimento dei token: ${transferError.message}`);
      }
    } catch (error) {
      // Gestione dell'errore generale
      this.logError('unlockLiquidity', error, { lockId, requestor: requestor?.toString() });
      
      throw error; // Rilancia l'errore per gestione esterna
    }
  }
  
  // Estendi il periodo di lock (con incentivi aggiuntivi)
  async extendLockPeriod(lockId, newLockPeriod, requestor) {
    try {
      // Validazione degli input
      if (!lockId || typeof lockId !== 'string') {
        throw new Error('lockId non valido');
      }
      
      if (!Object.values(LOCK_PERIODS).includes(newLockPeriod)) {
        throw new Error('Nuovo periodo di lock non valido');
      }
      
      let requestorPubkey;
      if (requestor) {
        try {
          // Verifica che requestor sia una PublicKey valida
          requestorPubkey = new PublicKey(requestor);
        } catch (error) {
          throw new Error(`Indirizzo requestor non valido: ${error.message}`);
        }
      }
      
      // Trova il record di lock
      const lockIndex = this.lockedLiquidity.findIndex(lock => lock.id === lockId);
      
      if (lockIndex === -1) {
        throw new Error(`Lock non trovato con ID: ${lockId}`);
      }
      
      const lock = this.lockedLiquidity[lockIndex];
      
      // Verifica che il richiedente sia il proprietario del lock
      if (requestorPubkey && lock.liquidityProvider !== requestorPubkey.toString()) {
        throw new Error('Non autorizzato: solo il provider di liquidità può modificare i propri lock');
      }
      
      // Verifica se il lock è già stato sbloccato
      if (lock.status === 'UNLOCKED') {
        throw new Error('Questo lock è già stato sbloccato');
      }
      
      // Verifica che il nuovo periodo sia più lungo del periodo attuale
      if (newLockPeriod <= lock.lockPeriod) {
        throw new Error('Il nuovo periodo di lock deve essere più lungo del periodo attuale');
      }
      
      // Calcola il nuovo incentivo
      let newIncentivePercentage = 0;
      let newPeriodName = '';
      
      if (newLockPeriod === LOCK_PERIODS.SIX_MONTHS) {
        newIncentivePercentage = LOCK_INCENTIVES.SIX_MONTHS;
        newPeriodName = 'SIX_MONTHS';
      } else if (newLockPeriod === LOCK_PERIODS.ONE_YEAR) {
        newIncentivePercentage = LOCK_INCENTIVES.ONE_YEAR;
        newPeriodName = 'ONE_YEAR';
      } else if (newLockPeriod === LOCK_PERIODS.THREE_YEARS) {
        newIncentivePercentage = LOCK_INCENTIVES.THREE_YEARS;
        newPeriodName = 'THREE_YEARS';
      } else if (newLockPeriod === LOCK_PERIODS.FIVE_YEARS) {
        newIncentivePercentage = LOCK_INCENTIVES.FIVE_YEARS;
        newPeriodName = 'FIVE_YEARS';
      }
      
      // Calcola l'incentivo aggiuntivo (differenza tra nuovo e vecchio incentivo)
      const additionalIncentivePercentage = newIncentivePercentage - lock.incentivePercentage;
      
      if (additionalIncentivePercentage <= 0) {
        throw new Error('Il nuovo periodo non offre incentivi aggiuntivi');
      }
      
      // Calcolo sicuro dell'incentivo aggiuntivo
      const additionalIncentiveAmount = this.math.clamp(
        Math.floor(this.math.multiply(lock.amount, this.math.divide(additionalIncentivePercentage, 100))),
        0,
        Number.MAX_SAFE_INTEGER
      );
      
      const now = new Date();
      const newUnlockDate = new Date(now.getTime() + newLockPeriod);
      
      try {
        // Simulazione di distribuzione degli incentivi aggiuntivi
        console.log(`Distribuzione di ${additionalIncentiveAmount} token di incentivo aggiuntivo a ${lock.liquidityProvider}`);
        
        // Aggiorna il lock
        const oldUnlockDate = lock.unlockDate;
        lock.lockPeriod = newLockPeriod;
        lock.periodName = newPeriodName;
        lock.incentivePercentage = newIncentivePercentage;
        lock.incentiveAmount = this.math.add(lock.incentiveAmount, additionalIncentiveAmount);
        lock.unlockDate = newUnlockDate.toISOString();
        
        // Aggiungi la transazione alla storia del lock
        lock.transactions.push({
          type: 'EXTEND',
          timestamp: now.toISOString(),
          oldUnlockDate,
          newUnlockDate: lock.unlockDate,
          additionalIncentiveAmount,
          totalIncentiveAmount: lock.incentiveAmount
        });
        
        console.log(`Periodo di lock esteso con successo fino a ${newUnlockDate.toLocaleDateString()}`);
        console.log(`Incentivo aggiuntivo: ${additionalIncentiveAmount} token (${additionalIncentivePercentage}%)`);
        console.log(`Incentivo totale: ${lock.incentiveAmount} token (${newIncentivePercentage}%)`);
        
        return lock;
      } catch (transferError) {
        // Gestione dell'errore durante la distribuzione degli incentivi
        this.logError('extendLockPeriod_transfer', transferError, { 
          lockId, 
          newLockPeriod,
          additionalIncentiveAmount 
        });
        
        throw new Error(`Errore durante la distribuzione degli incentivi: ${transferError.message}`);
      }
    } catch (error) {
      // Gestione dell'errore generale
      this.logError('extendLockPeriod', error, { 
        lockId, 
        newLockPeriod,
        requestor: requestor?.toString() 
      });
      
      throw error; // Rilancia l'errore per gestione esterna
    }
  }
  
  // Ottieni tutti i lock di liquidità
  getAllLocks(filterOptions = {}) {
    try {
      let filteredLocks = [...this.lockedLiquidity];
      
      // Filtra per provider
      if (filterOptions.provider) {
        try {
          const providerAddress = new PublicKey(filterOptions.provider).toString();
          filteredLocks = filteredLocks.filter(lock => lock.liquidityProvider === providerAddress);
        } catch (error) {
          throw new Error(`Indirizzo provider non valido: ${error.message}`);
        }
      }
      
      // Filtra per stato
      if (filterOptions.status) {
        if (!['LOCKED', 'UNLOCKED', 'ALL'].includes(filterOptions.status)) {
          throw new Error('Stato non valido. Valori consentiti: LOCKED, UNLOCKED, ALL');
        }
        
        if (filterOptions.status !== 'ALL') {
          filteredLocks = filteredLocks.filter(lock => lock.status === filterOptions.status);
        }
      }
      
      // Filtra per periodo
      if (filterOptions.periodName) {
        if (!['SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS', 'FIVE_YEARS', 'ALL'].includes(filterOptions.periodName)) {
          throw new Error('Periodo non valido. Valori consentiti: SIX_MONTHS, ONE_YEAR, THREE_YEARS, FIVE_YEARS, ALL');
        }
        
        if (filterOptions.periodName !== 'ALL') {
          filteredLocks = filteredLocks.filter(lock => lock.periodName === filterOptions.periodName);
        }
      }
      
      return filteredLocks;
    } catch (error) {
      this.logError('getAllLocks', error, { filterOptions });
      throw error;
    }
  }
  
  // Ottieni statistiche sui lock
  getLockStatistics() {
    try {
      const totalLocked = this.lockedLiquidity.reduce((sum, lock) => {
        if (lock.status === 'LOCKED') {
          return this.math.add(sum, lock.amount);
        }
        return sum;
      }, 0);
      
      const totalIncentives = this.lockedLiquidity.reduce((sum, lock) => {
        if (lock.status === 'LOCKED') {
          return this.math.add(sum, lock.incentiveAmount);
        }
        return sum;
      }, 0);
      
      const locksByPeriod = {
        SIX_MONTHS: 0,
        ONE_YEAR: 0,
        THREE_YEARS: 0,
        FIVE_YEARS: 0
      };
      
      const amountByPeriod = {
        SIX_MONTHS: 0,
        ONE_YEAR: 0,
        THREE_YEARS: 0,
        FIVE_YEARS: 0
      };
      
      this.lockedLiquidity.forEach(lock => {
        if (lock.status === 'LOCKED') {
          locksByPeriod[lock.periodName]++;
          amountByPeriod[lock.periodName] = this.math.add(amountByPeriod[lock.periodName], lock.amount);
        }
      });
      
      const uniqueProviders = new Set(
        this.lockedLiquidity
          .filter(lock => lock.status === 'LOCKED')
          .map(lock => lock.liquidityProvider)
      );
      
      return {
        totalLocked,
        totalIncentives,
        locksByPeriod,
        amountByPeriod,
        activeLocks: this.lockedLiquidity.filter(lock => lock.status === 'LOCKED').length,
        completedLocks: this.lockedLiquidity.filter(lock => lock.status === 'UNLOCKED').length,
        uniqueProviders: uniqueProviders.size,
        errorCount: this.errorLog.length
      };
    } catch (error) {
      this.logError('getLockStatistics', error);
      
      // Restituisci statistiche di base in caso di errore
      return {
        totalLocked: 0,
        totalIncentives: 0,
        locksByPeriod: {
          SIX_MONTHS: 0,
          ONE_YEAR: 0,
          THREE_YEARS: 0,
          FIVE_YEARS: 0
        },
        amountByPeriod: {
          SIX_MONTHS: 0,
          ONE_YEAR: 0,
          THREE_YEARS: 0,
          FIVE_YEARS: 0
        },
        activeLocks: 0,
        completedLocks: 0,
        uniqueProviders: 0,
        errorCount: this.errorLog.length,
        error: error.message
      };
    }
  }
  
  // Ottieni il log degli errori
  getErrorLog(limit = 10) {
    try {
      // Limita il numero di errori restituiti
      return this.errorLog.slice(-Math.min(limit, this.errorLog.length));
    } catch (error) {
      console.error('Errore durante il recupero del log degli errori:', error);
      return [];
    }
  }
  
  // Ripristina lo stato in caso di errore critico
  async recoverFromError(errorId) {
    try {
      // Trova l'errore nel log
      const errorEntry = this.errorLog.find(entry => entry.timestamp === errorId);
      
      if (!errorEntry) {
        throw new Error(`Errore con ID ${errorId} non trovato nel log`);
      }
      
      console.log(`Tentativo di ripristino da errore: ${errorEntry.operation}`);
      
      // Implementa logica di ripristino specifica per ogni tipo di operazione
      switch (errorEntry.operation) {
        case 'lockLiquidity':
        case 'lockLiquidity_transfer':
          // Ripristino per errori durante il lock
          console.log('Ripristino da errore di lock: nessuna azione necessaria, il lock non è stato creato');
          break;
          
        case 'unlockLiquidity':
        case 'unlockLiquidity_transfer':
          // Ripristino per errori durante lo sblocco
          if (errorEntry.metadata && errorEntry.metadata.lockId) {
            const lockIndex = this.lockedLiquidity.findIndex(lock => lock.id === errorEntry.metadata.lockId);
            
            if (lockIndex !== -1) {
              const lock = this.lockedLiquidity[lockIndex];
              
              // Se lo stato è stato cambiato a UNLOCKED ma il trasferimento è fallito, ripristina lo stato
              if (lock.status === 'UNLOCKED' && errorEntry.operation === 'unlockLiquidity_transfer') {
                console.log(`Ripristino dello stato del lock ${lock.id} a LOCKED`);
                lock.status = 'LOCKED';
                delete lock.unlockExecutionDate;
                
                // Rimuovi l'ultima transazione (che era lo sblocco fallito)
                if (lock.transactions && lock.transactions.length > 0 && 
                    lock.transactions[lock.transactions.length - 1].type === 'UNLOCK') {
                  lock.transactions.pop();
                }
                
                // Aggiungi una transazione di ripristino
                lock.transactions.push({
                  type: 'RECOVERY',
                  timestamp: new Date().toISOString(),
                  description: 'Ripristino da errore di sblocco'
                });
              }
            }
          }
          break;
          
        case 'extendLockPeriod':
        case 'extendLockPeriod_transfer':
          // Ripristino per errori durante l'estensione del periodo
          if (errorEntry.metadata && errorEntry.metadata.lockId) {
            const lockIndex = this.lockedLiquidity.findIndex(lock => lock.id === errorEntry.metadata.lockId);
            
            if (lockIndex !== -1) {
              const lock = this.lockedLiquidity[lockIndex];
              
              // Se ci sono transazioni di tipo EXTEND, ripristina lo stato precedente all'ultima estensione
              if (lock.transactions) {
                const extendTransactions = lock.transactions.filter(tx => tx.type === 'EXTEND');
                
                if (extendTransactions.length > 0) {
                  const lastExtend = extendTransactions[extendTransactions.length - 1];
                  
                  console.log(`Ripristino del periodo di lock ${lock.id} alla data precedente: ${lastExtend.oldUnlockDate}`);
                  
                  // Ripristina la data di sblocco precedente
                  lock.unlockDate = lastExtend.oldUnlockDate;
                  
                  // Calcola il periodo di lock corrispondente
                  const now = new Date();
                  const unlockDate = new Date(lock.unlockDate);
                  lock.lockPeriod = unlockDate.getTime() - now.getTime();
                  
                  // Ripristina il periodo e l'incentivo
                  if (lock.lockPeriod <= LOCK_PERIODS.SIX_MONTHS) {
                    lock.periodName = 'SIX_MONTHS';
                    lock.incentivePercentage = LOCK_INCENTIVES.SIX_MONTHS;
                  } else if (lock.lockPeriod <= LOCK_PERIODS.ONE_YEAR) {
                    lock.periodName = 'ONE_YEAR';
                    lock.incentivePercentage = LOCK_INCENTIVES.ONE_YEAR;
                  } else if (lock.lockPeriod <= LOCK_PERIODS.THREE_YEARS) {
                    lock.periodName = 'THREE_YEARS';
                    lock.incentivePercentage = LOCK_INCENTIVES.THREE_YEARS;
                  } else {
                    lock.periodName = 'FIVE_YEARS';
                    lock.incentivePercentage = LOCK_INCENTIVES.FIVE_YEARS;
                  }
                  
                  // Ricalcola l'incentivo
                  lock.incentiveAmount = Math.floor(this.math.multiply(lock.amount, this.math.divide(lock.incentivePercentage, 100)));
                  
                  // Rimuovi l'ultima transazione (che era l'estensione fallita)
                  if (lock.transactions[lock.transactions.length - 1].type === 'EXTEND') {
                    lock.transactions.pop();
                  }
                  
                  // Aggiungi una transazione di ripristino
                  lock.transactions.push({
                    type: 'RECOVERY',
                    timestamp: new Date().toISOString(),
                    description: 'Ripristino da errore di estensione del periodo'
                  });
                }
              }
            }
          }
          break;
          
        default:
          console.log(`Nessuna procedura di ripristino specifica per l'operazione ${errorEntry.operation}`);
      }
      
      console.log('Ripristino completato con successo');
      
      // Rimuovi l'errore dal log
      const errorIndex = this.errorLog.findIndex(entry => entry.timestamp === errorId);
      if (errorIndex !== -1) {
        this.errorLog.splice(errorIndex, 1);
      }
      
      return {
        success: true,
        message: `Ripristino da errore ${errorEntry.operation} completato con successo`
      };
    } catch (error) {
      console.error('Errore durante il ripristino:', error);
      
      // Aggiungi l'errore di ripristino al log
      this.logError('recoverFromError', error, { errorId });
      
      return {
        success: false,
        message: `Errore durante il ripristino: ${error.message}`
      };
    }
  }
}

// Funzione per deployare il Lock Liquidity
async function deployLockLiquidity(tokenAddress) {
  console.log('Iniziando il deployment del Lock Liquidity...');
  
  try {
    // Validazione dell'input tokenAddress
    if (!tokenAddress) {
      throw new Error('Indirizzo token non specificato');
    }
    
    let tokenPubkey;
    try {
      // Verifica che tokenAddress sia una PublicKey valida
      tokenPubkey = new PublicKey(tokenAddress);
    } catch (error) {
      throw new Error(`Indirizzo token non valido: ${error.message}`);
    }
    
    // Configurazione della connessione
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Verifica che il token esista
    try {
      const tokenInfo = await connection.getTokenSupply(tokenPubkey);
      console.log(`Token verificato: supply=${tokenInfo.value.uiAmount}, decimals=${tokenInfo.value.decimals}`);
    } catch (error) {
      throw new Error(`Token non trovato o non valido: ${error.message}`);
    }
    
    // Carica il wallet dal file di configurazione
    const walletKeyfile = path.join(process.env.HOME, '.config', 'solana', 'id.json');
    
    // Verifica che il file del wallet esista
    if (!fs.existsSync(walletKeyfile)) {
      throw new Error(`File del wallet non trovato: ${walletKeyfile}`);
    }
    
    let walletKeypair;
    try {
      walletKeypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(fs.readFileSync(walletKeyfile, 'utf-8')))
      );
    } catch (error) {
      throw new Error(`Errore durante il caricamento del wallet: ${error.message}`);
    }
    
    console.log(`Usando il wallet: ${walletKeypair.publicKey.toString()}`);
    
    // Crea un'istanza del Lock Liquidity
    const lockLiquidity = new LockLiquidity(connection, tokenPubkey);
    
    // Salva le informazioni del Lock Liquidity
    const lockLiquidityInfo = {
      tokenAddress: tokenPubkey.toString(),
      lockPeriods: {
        SIX_MONTHS: LOCK_PERIODS.SIX_MONTHS / (24 * 60 * 60 * 1000), // Converti in giorni
        ONE_YEAR: LOCK_PERIODS.ONE_YEAR / (24 * 60 * 60 * 1000),
        THREE_YEARS: LOCK_PERIODS.THREE_YEARS / (24 * 60 * 60 * 1000),
        FIVE_YEARS: LOCK_PERIODS.FIVE_YEARS / (24 * 60 * 60 * 1000)
      },
      lockIncentives: LOCK_INCENTIVES,
      limits: {
        MAX_LOCK_AMOUNT,
        MIN_LOCK_AMOUNT,
        MAX_LOCKS_PER_PROVIDER
      },
      deploymentTimestamp: new Date().toISOString(),
      deployer: walletKeypair.publicKey.toString()
    };
    
    // Salva le informazioni in un file JSON
    const infoPath = path.join(__dirname, '../deployment-info/lock_liquidity_info.json');
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify(lockLiquidityInfo, null, 2));
    
    console.log(`Lock Liquidity deployato con successo per il token: ${tokenPubkey.toString()}`);
    console.log(`Informazioni salvate in: ${infoPath}`);
    
    return lockLiquidityInfo;
  } catch (error) {
    console.error('Errore durante il deployment del Lock Liquidity:', error);
    throw error;
  }
}

// Esporta la classe e la funzione di deployment
module.exports = {
  LockLiquidity,
  deployLockLiquidity,
  LOCK_PERIODS,
  LOCK_INCENTIVES
};

// Se eseguito direttamente, esegui il deployment
if (require.main === module) {
  // Prendi l'indirizzo del token come argomento
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.error('Errore: Indirizzo del token non specificato');
    console.log('Uso: node lock_liquidity.js <indirizzo_token>');
    process.exit(1);
  }
  
  deployLockLiquidity(tokenAddress)
    .then(info => {
      console.log('Lock Liquidity deployato con successo!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Errore durante il deployment del Lock Liquidity:', error);
      process.exit(1);
    });
}
