// Anti-Rug System Program per Solana
// Questo programma valuta automaticamente il rischio di rug pull e protegge gli investitori

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, TransactionInstruction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configurazione
const RISK_THRESHOLD = 70; // Soglia di rischio (0-100)
const MONITORING_INTERVAL = 3600000; // Intervallo di monitoraggio in ms (1 ora)
const MAX_RISK_SCORE = 100; // Punteggio massimo di rischio
const MIN_RISK_SCORE = 0; // Punteggio minimo di rischio

// Configurazione anti-front-running
const FRONT_RUNNING_PROTECTION = {
  // Configurazione del commit-reveal pattern
  COMMIT_REVEAL: {
    ENABLED: true,
    REVEAL_WINDOW_MS: 60000, // Finestra di reveal in ms (1 minuto)
    COMMIT_EXPIRY_MS: 300000, // Scadenza del commit in ms (5 minuti)
    MIN_BLOCKS_DELAY: 2 // Numero minimo di blocchi di ritardo tra commit e reveal
  },
  // Configurazione dell'offuscamento delle transazioni
  TRANSACTION_OBFUSCATION: {
    ENABLED: true,
    NONCE_BYTES: 32, // Dimensione del nonce in bytes
    HASH_ALGORITHM: 'sha256' // Algoritmo di hash per l'offuscamento
  },
  // Configurazione dei limiti di slippage
  SLIPPAGE_PROTECTION: {
    ENABLED: true,
    DEFAULT_MAX_SLIPPAGE_PERCENT: 1.0, // Slippage massimo predefinito (1%)
    STRICT_MODE_MAX_SLIPPAGE_PERCENT: 0.5, // Slippage massimo in modalità strict (0.5%)
    PRICE_VALIDITY_WINDOW_MS: 30000 // Finestra di validità del prezzo in ms (30 secondi)
  },
  // Configurazione della protezione MEV (Miner Extractable Value)
  MEV_PROTECTION: {
    ENABLED: true,
    PRIVATE_TRANSACTIONS_ENABLED: true, // Abilita transazioni private
    BUNDLE_TRANSACTIONS: true, // Raggruppa transazioni correlate
    RANDOMIZE_SUBMISSION_TIME: true // Randomizza il tempo di invio delle transazioni
  }
};

// Fattori di rischio e loro pesi
const RISK_FACTORS = {
  liquidityPercentage: { weight: 30, description: 'Percentuale di liquidità rispetto alla market cap' },
  tokenConcentration: { weight: 25, description: 'Concentrazione dei token nei wallet principali' },
  contractAudit: { weight: 20, description: 'Audit del contratto da parte di terzi' },
  teamDoxxed: { weight: 15, description: 'Team identificato pubblicamente' },
  socialMediaPresence: { weight: 10, description: 'Presenza sui social media e attività della community' }
};

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

// Classe per gestire la protezione anti-front-running
class FrontRunningProtection {
  constructor(connection) {
    if (!connection) {
      throw new Error('Connection non può essere null o undefined');
    }
    
    this.connection = connection;
    this.pendingCommits = new Map(); // Mappa dei commit in attesa
    this.revealedTransactions = new Map(); // Mappa delle transazioni rivelate
    this.transactionNonces = new Map(); // Mappa dei nonce per le transazioni
    this.priceCache = new Map(); // Cache dei prezzi per la protezione slippage
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
  
  // Genera un nonce casuale
  generateNonce() {
    return crypto.randomBytes(FRONT_RUNNING_PROTECTION.TRANSACTION_OBFUSCATION.NONCE_BYTES);
  }
  
  // Offusca una transazione con un nonce
  obfuscateTransaction(transaction, nonce) {
    try {
      // Validazione degli input
      if (!transaction) {
        throw new Error('Transaction non può essere null o undefined');
      }
      
      if (!nonce || !Buffer.isBuffer(nonce)) {
        throw new Error('Nonce non valido');
      }
      
      // Crea un hash del nonce
      const nonceHash = crypto.createHash(FRONT_RUNNING_PROTECTION.TRANSACTION_OBFUSCATION.HASH_ALGORITHM)
        .update(nonce)
        .digest();
      
      // Crea un'istruzione di memo con il nonce hash
      const memoInstruction = new TransactionInstruction({
        keys: [],
        programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from(nonceHash)
      });
      
      // Aggiungi l'istruzione di memo alla transazione
      transaction.add(memoInstruction);
      
      // Memorizza il nonce per questa transazione
      const transactionId = transaction.signature?.toString() || crypto.randomBytes(16).toString('hex');
      this.transactionNonces.set(transactionId, nonce);
      
      return {
        transaction,
        transactionId,
        nonce: nonce.toString('hex')
      };
    } catch (error) {
      this.logError('obfuscateTransaction', error);
      throw error;
    }
  }
  
  // Crea un commit per una transazione (fase 1 del commit-reveal pattern)
  async createCommitment(transactionIntent, sender) {
    try {
      // Validazione degli input
      if (!transactionIntent || typeof transactionIntent !== 'object') {
        throw new Error('TransactionIntent non può essere null o undefined');
      }
      
      if (!sender) {
        throw new Error('Sender non può essere null o undefined');
      }
      
      let senderPubkey;
      try {
        // Verifica che sender sia una PublicKey valida
        senderPubkey = sender instanceof PublicKey ? sender : new PublicKey(sender);
      } catch (error) {
        throw new Error(`Indirizzo sender non valido: ${error.message}`);
      }
      
      // Genera un nonce casuale
      const nonce = this.generateNonce();
      
      // Crea un hash dell'intent della transazione con il nonce
      const intentString = JSON.stringify(transactionIntent);
      const commitHash = crypto.createHash(FRONT_RUNNING_PROTECTION.TRANSACTION_OBFUSCATION.HASH_ALGORITHM)
        .update(Buffer.concat([Buffer.from(intentString), nonce]))
        .digest('hex');
      
      // Ottieni il blocco corrente
      const slot = await this.connection.getSlot();
      
      // Memorizza il commit
      const commitment = {
        commitHash,
        nonce: nonce.toString('hex'),
        sender: senderPubkey.toString(),
        intent: transactionIntent,
        createdAt: Date.now(),
        expiresAt: Date.now() + FRONT_RUNNING_PROTECTION.COMMIT_REVEAL.COMMIT_EXPIRY_MS,
        slot,
        minRevealSlot: slot + FRONT_RUNNING_PROTECTION.COMMIT_REVEAL.MIN_BLOCKS_DELAY,
        revealed: false
      };
      
      this.pendingCommits.set(commitHash, commitment);
      
      // Pulisci i commit scaduti
      this.cleanupExpiredCommitments();
      
      return {
        commitHash,
        nonce: nonce.toString('hex'),
        expiresAt: commitment.expiresAt,
        minRevealSlot: commitment.minRevealSlot
      };
    } catch (error) {
      this.logError('createCommitment', error, { sender: sender?.toString() });
      throw error;
    }
  }
  
  // Rivela una transazione (fase 2 del commit-reveal pattern)
  async revealTransaction(commitHash, nonce, transaction) {
    try {
      // Validazione degli input
      if (!commitHash || typeof commitHash !== 'string') {
        throw new Error('CommitHash non può essere null o undefined');
      }
      
      if (!nonce || typeof nonce !== 'string') {
        throw new Error('Nonce non può essere null o undefined');
      }
      
      if (!transaction) {
        throw new Error('Transaction non può essere null o undefined');
      }
      
      // Verifica che il commit esista
      if (!this.pendingCommits.has(commitHash)) {
        throw new Error(`Commit non trovato: ${commitHash}`);
      }
      
      const commitment = this.pendingCommits.get(commitHash);
      
      // Verifica che il commit non sia scaduto
      if (Date.now() > commitment.expiresAt) {
        this.pendingCommits.delete(commitHash);
        throw new Error(`Commit scaduto: ${commitHash}`);
      }
      
      // Verifica che il nonce corrisponda
      if (commitment.nonce !== nonce) {
        throw new Error('Nonce non valido');
      }
      
      // Verifica che il commit non sia già stato rivelato
      if (commitment.revealed) {
        throw new Error(`Commit già rivelato: ${commitHash}`);
      }
      
      // Ottieni il blocco corrente
      const slot = await this.connection.getSlot();
      
      // Verifica che sia passato il numero minimo di blocchi
      if (slot < commitment.minRevealSlot) {
        throw new Error(`Reveal troppo presto. Blocco corrente: ${slot}, blocco minimo: ${commitment.minRevealSlot}`);
      }
      
      // Marca il commit come rivelato
      commitment.revealed = true;
      commitment.revealedAt = Date.now();
      commitment.revealSlot = slot;
      
      // Memorizza la transazione rivelata
      const transactionId = transaction.signature?.toString() || crypto.randomBytes(16).toString('hex');
      this.revealedTransactions.set(transactionId, {
        commitHash,
        transaction,
        revealedAt: commitment.revealedAt,
        sender: commitment.sender
      });
      
      return {
        success: true,
        transactionId,
        commitHash,
        revealedAt: commitment.revealedAt,
        revealSlot: commitment.revealSlot
      };
    } catch (error) {
      this.logError('revealTransaction', error, { commitHash, nonce });
      throw error;
    }
  }
  
  // Pulisce i commit scaduti
  cleanupExpiredCommitments() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [commitHash, commitment] of this.pendingCommits.entries()) {
      if (now > commitment.expiresAt) {
        this.pendingCommits.delete(commitHash);
        expiredCount++;
      }
    }
    
    if (expiredCount > 0) {
      console.log(`Rimossi ${expiredCount} commit scaduti`);
    }
  }
  
  // Verifica lo slippage per una transazione
  async checkSlippage(tokenAddress, amount, expectedPrice, maxSlippagePercent = null) {
    try {
      // Validazione degli input
      if (!tokenAddress) {
        throw new Error('TokenAddress non può essere null o undefined');
      }
      
      let tokenPubkey;
      try {
        // Verifica che tokenAddress sia una PublicKey valida
        tokenPubkey = tokenAddress instanceof PublicKey ? tokenAddress : new PublicKey(tokenAddress);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        throw new Error('Amount deve essere un numero positivo');
      }
      
      if (typeof expectedPrice !== 'number' || isNaN(expectedPrice) || expectedPrice <= 0) {
        throw new Error('ExpectedPrice deve essere un numero positivo');
      }
      
      // Usa lo slippage predefinito se non specificato
      const slippagePercent = maxSlippagePercent !== null ? 
        maxSlippagePercent : 
        FRONT_RUNNING_PROTECTION.SLIPPAGE_PROTECTION.DEFAULT_MAX_SLIPPAGE_PERCENT;
      
      // Validazione dello slippage
      if (typeof slippagePercent !== 'number' || isNaN(slippagePercent) || slippagePercent < 0) {
        throw new Error('SlippagePercent deve essere un numero non negativo');
      }
      
      // Ottieni il prezzo corrente
      let currentPrice;
      const tokenKey = tokenPubkey.toString();
      
      // Verifica se il prezzo è nella cache e se è ancora valido
      if (this.priceCache.has(tokenKey)) {
        const cachedPrice = this.priceCache.get(tokenKey);
        const priceAge = Date.now() - cachedPrice.timestamp;
        
        if (priceAge < FRONT_RUNNING_PROTECTION.SLIPPAGE_PROTECTION.PRICE_VALIDITY_WINDOW_MS) {
          currentPrice = cachedPrice.price;
        } else {
          // Prezzo scaduto, rimuovilo dalla cache
          this.priceCache.delete(tokenKey);
        }
      }
      
      // Se il prezzo non è nella cache o è scaduto, ottienilo
      if (!currentPrice) {
        // In un'implementazione reale, qui otterremmo il prezzo da un oracolo o da un DEX
        // Per questa simulazione, usiamo un prezzo casuale vicino a quello atteso
        const deviation = (Math.random() * 2 - 1) * 0.005; // Deviazione casuale ±0.5%
        currentPrice = expectedPrice * (1 + deviation);
        
        // Memorizza il prezzo nella cache
        this.priceCache.set(tokenKey, {
          price: currentPrice,
          timestamp: Date.now()
        });
      }
      
      // Calcola la differenza percentuale tra il prezzo atteso e quello corrente
      const priceDiffPercent = Math.abs(this.math.divide(
        this.math.multiply(currentPrice - expectedPrice, 100),
        expectedPrice
      ));
      
      // Verifica se lo slippage è accettabile
      const isSlippageAcceptable = priceDiffPercent <= slippagePercent;
      
      return {
        isAcceptable: isSlippageAcceptable,
        expectedPrice,
        currentPrice,
        priceDiffPercent,
        maxSlippagePercent: slippagePercent,
        tokenAddress: tokenPubkey.toString()
      };
    } catch (error) {
      this.logError('checkSlippage', error, { 
        tokenAddress: tokenAddress?.toString(),
        amount,
        expectedPrice,
        maxSlippagePercent
      });
      
      throw error;
    }
  }
  
  // Crea una transazione privata (per protezione MEV)
  async createPrivateTransaction(transaction, sender) {
    try {
      // Validazione degli input
      if (!transaction) {
        throw new Error('Transaction non può essere null o undefined');
      }
      
      if (!sender) {
        throw new Error('Sender non può essere null o undefined');
      }
      
      let senderPubkey;
      try {
        // Verifica che sender sia una PublicKey valida
        senderPubkey = sender instanceof PublicKey ? sender : new PublicKey(sender);
      } catch (error) {
        throw new Error(`Indirizzo sender non valido: ${error.message}`);
      }
      
      // In un'implementazione reale, qui invieremmo la transazione a un servizio di relay privato
      // Per questa simulazione, offuschiamo semplicemente la transazione
      
      // Genera un nonce casuale
      const nonce = this.generateNonce();
      
      // Offusca la transazione
      const obfuscatedTx = this.obfuscateTransaction(transaction, nonce);
      
      // Simula un ritardo casuale per l'invio (protezione MEV)
      if (FRONT_RUNNING_PROTECTION.MEV_PROTECTION.RANDOMIZE_SUBMISSION_TIME) {
        const delay = Math.floor(Math.random() * 2000); // Ritardo casuale fino a 2 secondi
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      return {
        success: true,
        transactionId: obfuscatedTx.transactionId,
        nonce: obfuscatedTx.nonce,
        isPrivate: true,
        sender: senderPubkey.toString()
      };
    } catch (error) {
      this.logError('createPrivateTransaction', error, { sender: sender?.toString() });
      throw error;
    }
  }
  
  // Raggruppa più transazioni in un bundle (per protezione MEV)
  async bundleTransactions(transactions, executor) {
    try {
      // Validazione degli input
      if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        throw new Error('Transactions deve essere un array non vuoto');
      }
      
      if (!executor) {
        throw new Error('Executor non può essere null o undefined');
      }
      
      let executorPubkey;
      try {
        // Verifica che executor sia una PublicKey valida
        executorPubkey = executor instanceof PublicKey ? executor : new PublicKey(executor);
      } catch (error) {
        throw new Error(`Indirizzo executor non valido: ${error.message}`);
      }
      
      // In un'implementazione reale, qui raggrupperemmo le transazioni in un bundle
      // e lo invieremmo a un servizio di bundling
      
      // Per questa simulazione, creiamo un ID bundle e associamo le transazioni ad esso
      const bundleId = crypto.randomBytes(16).toString('hex');
      
      // Offusca ogni transazione nel bundle
      const bundledTransactions = [];
      for (const tx of transactions) {
        const nonce = this.generateNonce();
        const obfuscatedTx = this.obfuscateTransaction(tx, nonce);
        bundledTransactions.push(obfuscatedTx);
      }
      
      return {
        success: true,
        bundleId,
        transactionCount: bundledTransactions.length,
        transactions: bundledTransactions.map(tx => tx.transactionId),
        executor: executorPubkey.toString()
      };
    } catch (error) {
      this.logError('bundleTransactions', error, { 
        transactionCount: transactions?.length,
        executor: executor?.toString()
      });
      
      throw error;
    }
  }
  
  // Ottieni statistiche sulla protezione anti-front-running
  getStats() {
    return {
      pendingCommits: this.pendingCommits.size,
      revealedTransactions: this.revealedTransactions.size,
      transactionNonces: this.transactionNonces.size,
      priceCacheSize: this.priceCache.size,
      errorCount: this.errorLog.length,
      config: FRONT_RUNNING_PROTECTION
    };
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
}

class AntiRugSystem {
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
    this.monitoringInterval = null;
    this.riskScore = 0;
    this.lastAssessment = null;
    this.alertSubscribers = [];
    this.math = safeArithmetic(); // Inizializza le funzioni aritmetiche sicure
    this.frontRunningProtection = new FrontRunningProtection(connection); // Inizializza la protezione anti-front-running
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

  // Calcola il punteggio di rischio per un token
  async calculateRiskScore(tokenData) {
    try {
      console.log(`Calcolando il punteggio di rischio per il token: ${this.tokenAddress.toString()}`);
      
      // Validazione dell'input
      if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('tokenData deve essere un oggetto valido');
      }
      
      let totalScore = 0;
      let maxPossibleScore = 0;
      
      // Valuta la percentuale di liquidità
      if (tokenData.liquidityPercentage !== undefined) {
        // Validazione e normalizzazione dell'input
        const liquidityPercentage = this.math.clamp(
          parseFloat(tokenData.liquidityPercentage) || 0, 
          0, 
          100
        );
        
        let liquidityScore;
        if (liquidityPercentage >= 50) {
          liquidityScore = 0;
        } else {
          // Calcolo sicuro: (50 - liquidityPercentage) * 2
          const diff = this.math.clamp(50 - liquidityPercentage, 0, 50);
          liquidityScore = this.math.multiply(diff, 2);
        }
        
        // Calcolo sicuro del contributo al punteggio totale
        const factorWeight = RISK_FACTORS.liquidityPercentage.weight;
        const scoreContribution = this.math.multiply(liquidityScore, factorWeight);
        totalScore = this.math.add(totalScore, scoreContribution);
        
        // Calcolo sicuro del punteggio massimo possibile
        const maxFactorScore = this.math.multiply(MAX_RISK_SCORE, factorWeight);
        maxPossibleScore = this.math.add(maxPossibleScore, maxFactorScore);
      }
      
      // Valuta la concentrazione dei token
      if (tokenData.tokenConcentration !== undefined) {
        // Validazione e normalizzazione dell'input
        const tokenConcentration = this.math.clamp(
          parseFloat(tokenData.tokenConcentration) || 0, 
          0, 
          100
        );
        
        let concentrationScore;
        if (tokenConcentration <= 20) {
          concentrationScore = 0;
        } else {
          // Calcolo sicuro: (tokenConcentration - 20) * 1.25
          const diff = this.math.clamp(tokenConcentration - 20, 0, 80);
          concentrationScore = this.math.multiply(diff, 1.25);
        }
        
        // Calcolo sicuro del contributo al punteggio totale
        const factorWeight = RISK_FACTORS.tokenConcentration.weight;
        const scoreContribution = this.math.multiply(concentrationScore, factorWeight);
        totalScore = this.math.add(totalScore, scoreContribution);
        
        // Calcolo sicuro del punteggio massimo possibile
        const maxFactorScore = this.math.multiply(MAX_RISK_SCORE, factorWeight);
        maxPossibleScore = this.math.add(maxPossibleScore, maxFactorScore);
      }
      
      // Valuta l'audit del contratto
      if (tokenData.contractAudit !== undefined) {
        // Validazione dell'input
        const contractAudit = Boolean(tokenData.contractAudit);
        
        const auditScore = contractAudit ? 0 : MAX_RISK_SCORE;
        
        // Calcolo sicuro del contributo al punteggio totale
        const factorWeight = RISK_FACTORS.contractAudit.weight;
        const scoreContribution = this.math.multiply(auditScore, factorWeight);
        totalScore = this.math.add(totalScore, scoreContribution);
        
        // Calcolo sicuro del punteggio massimo possibile
        const maxFactorScore = this.math.multiply(MAX_RISK_SCORE, factorWeight);
        maxPossibleScore = this.math.add(maxPossibleScore, maxFactorScore);
      }
      
      // Valuta se il team è doxxed
      if (tokenData.teamDoxxed !== undefined) {
        // Validazione dell'input
        const teamDoxxed = Boolean(tokenData.teamDoxxed);
        
        const doxxedScore = teamDoxxed ? 0 : MAX_RISK_SCORE;
        
        // Calcolo sicuro del contributo al punteggio totale
        const factorWeight = RISK_FACTORS.teamDoxxed.weight;
        const scoreContribution = this.math.multiply(doxxedScore, factorWeight);
        totalScore = this.math.add(totalScore, scoreContribution);
        
        // Calcolo sicuro del punteggio massimo possibile
        const maxFactorScore = this.math.multiply(MAX_RISK_SCORE, factorWeight);
        maxPossibleScore = this.math.add(maxPossibleScore, maxFactorScore);
      }
      
      // Valuta la presenza sui social media
      if (tokenData.socialMediaPresence !== undefined) {
        // Validazione dell'input
        const socialMediaPresence = Boolean(tokenData.socialMediaPresence);
        
        const socialScore = socialMediaPresence ? 0 : MAX_RISK_SCORE;
        
        // Calcolo sicuro del contributo al punteggio totale
        const factorWeight = RISK_FACTORS.socialMediaPresence.weight;
        const scoreContribution = this.math.multiply(socialScore, factorWeight);
        totalScore = this.math.add(totalScore, scoreContribution);
        
        // Calcolo sicuro del punteggio massimo possibile
        const maxFactorScore = this.math.multiply(MAX_RISK_SCORE, factorWeight);
        maxPossibleScore = this.math.add(maxPossibleScore, maxFactorScore);
      }
      
      // Calcola il punteggio finale normalizzato in modo sicuro
      let normalizedScore;
      if (maxPossibleScore > 0) {
        // Calcolo sicuro: (totalScore / maxPossibleScore) * 100
        const ratio = this.math.divide(totalScore, maxPossibleScore);
        normalizedScore = this.math.multiply(ratio, MAX_RISK_SCORE);
      } else {
        normalizedScore = 0;
      }
      
      // Limita il punteggio finale nell'intervallo [0, 100]
      this.riskScore = this.math.clamp(Math.round(normalizedScore), MIN_RISK_SCORE, MAX_RISK_SCORE);
      this.lastAssessment = new Date();
      
      console.log(`Punteggio di rischio calcolato: ${this.riskScore}/${MAX_RISK_SCORE}`);
      
      // Emetti un allarme se il punteggio supera la soglia
      if (this.riskScore >= RISK_THRESHOLD) {
        this.emitRugPullAlert();
      }
      
      return this.riskScore;
    } catch (error) {
      this.logError('calculateRiskScore', error, { tokenData });
      throw error;
    }
  }
  
  // Inizia il monitoraggio continuo
  startMonitoring(tokenData) {
    try {
      // Validazione dell'input
      if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('tokenData deve essere un oggetto valido');
      }
      
      console.log(`Avvio del monitoraggio per il token: ${this.tokenAddress.toString()}`);
      
      // Ferma il monitoraggio esistente se presente
      this.stopMonitoring();
      
      // Calcola il punteggio iniziale
      this.calculateRiskScore(tokenData);
      
      // Imposta l'intervallo di monitoraggio
      this.monitoringInterval = setInterval(() => {
        try {
          this.calculateRiskScore(tokenData);
        } catch (error) {
          this.logError('monitoringInterval_calculateRiskScore', error);
        }
      }, MONITORING_INTERVAL);
      
      console.log(`Monitoraggio avviato con intervallo di ${MONITORING_INTERVAL / 1000 / 60} minuti`);
      
      return {
        success: true,
        tokenAddress: this.tokenAddress.toString(),
        initialRiskScore: this.riskScore,
        monitoringInterval: MONITORING_INTERVAL,
        startedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logError('startMonitoring', error, { tokenData });
      throw error;
    }
  }
  
  // Ferma il monitoraggio
  stopMonitoring() {
    try {
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
        console.log(`Monitoraggio fermato per il token: ${this.tokenAddress.toString()}`);
        
        return {
          success: true,
          tokenAddress: this.tokenAddress.toString(),
          lastRiskScore: this.riskScore,
          lastAssessment: this.lastAssessment?.toISOString(),
          stoppedAt: new Date().toISOString()
        };
      }
      
      return {
        success: false,
        message: 'Nessun monitoraggio attivo',
        tokenAddress: this.tokenAddress.toString()
      };
    } catch (error) {
      this.logError('stopMonitoring', error);
      throw error;
    }
  }
  
  // Iscriviti agli allarmi
  subscribeToAlerts(callback) {
    try {
      // Validazione dell'input
      if (typeof callback !== 'function') {
        throw new Error('callback deve essere una funzione');
      }
      
      this.alertSubscribers.push(callback);
      
      console.log(`Nuovo sottoscrittore agli allarmi per il token: ${this.tokenAddress.toString()}`);
      
      return {
        success: true,
        subscriberCount: this.alertSubscribers.length,
        tokenAddress: this.tokenAddress.toString(),
        subscribedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logError('subscribeToAlerts', error);
      throw error;
    }
  }
  
  // Emetti un allarme di rug pull
  emitRugPullAlert() {
    try {
      console.warn(`ALLARME RUG PULL per il token: ${this.tokenAddress.toString()}, punteggio di rischio: ${this.riskScore}`);
      
      const alert = {
        type: 'rug_pull_alert',
        tokenAddress: this.tokenAddress.toString(),
        riskScore: this.riskScore,
        timestamp: new Date().toISOString()
      };
      
      // Notifica tutti i sottoscrittori
      for (const callback of this.alertSubscribers) {
        try {
          callback(alert);
        } catch (error) {
          this.logError('emitRugPullAlert_callback', error);
        }
      }
      
      return alert;
    } catch (error) {
      this.logError('emitRugPullAlert', error);
      throw error;
    }
  }
  
  // Verifica una transazione per protezione anti-front-running
  async verifyTransaction(transaction, expectedPrice, sender, options = {}) {
    try {
      // Validazione degli input
      if (!transaction) {
        throw new Error('Transaction non può essere null o undefined');
      }
      
      if (typeof expectedPrice !== 'number' || isNaN(expectedPrice) || expectedPrice <= 0) {
        throw new Error('ExpectedPrice deve essere un numero positivo');
      }
      
      if (!sender) {
        throw new Error('Sender non può essere null o undefined');
      }
      
      let senderPubkey;
      try {
        // Verifica che sender sia una PublicKey valida
        senderPubkey = sender instanceof PublicKey ? sender : new PublicKey(sender);
      } catch (error) {
        throw new Error(`Indirizzo sender non valido: ${error.message}`);
      }
      
      // Opzioni predefinite
      const defaultOptions = {
        useCommitReveal: FRONT_RUNNING_PROTECTION.COMMIT_REVEAL.ENABLED,
        useTransactionObfuscation: FRONT_RUNNING_PROTECTION.TRANSACTION_OBFUSCATION.ENABLED,
        useSlippageProtection: FRONT_RUNNING_PROTECTION.SLIPPAGE_PROTECTION.ENABLED,
        useMevProtection: FRONT_RUNNING_PROTECTION.MEV_PROTECTION.ENABLED,
        maxSlippagePercent: FRONT_RUNNING_PROTECTION.SLIPPAGE_PROTECTION.DEFAULT_MAX_SLIPPAGE_PERCENT,
        amount: 1 // Importo predefinito per la verifica dello slippage
      };
      
      // Unisci le opzioni predefinite con quelle fornite
      const mergedOptions = { ...defaultOptions, ...options };
      
      // Risultati delle verifiche
      const results = {
        transaction: transaction.signature?.toString() || 'unknown',
        sender: senderPubkey.toString(),
        tokenAddress: this.tokenAddress.toString(),
        expectedPrice,
        verifications: {}
      };
      
      // Verifica lo slippage se abilitato
      if (mergedOptions.useSlippageProtection) {
        const slippageCheck = await this.frontRunningProtection.checkSlippage(
          this.tokenAddress,
          mergedOptions.amount,
          expectedPrice,
          mergedOptions.maxSlippagePercent
        );
        
        results.verifications.slippage = slippageCheck;
        
        // Se lo slippage non è accettabile, restituisci un errore
        if (!slippageCheck.isAcceptable) {
          results.success = false;
          results.error = `Slippage troppo alto: ${slippageCheck.priceDiffPercent.toFixed(2)}% > ${slippageCheck.maxSlippagePercent}%`;
          return results;
        }
      }
      
      // Usa il commit-reveal pattern se abilitato
      if (mergedOptions.useCommitReveal) {
        // Crea un intent della transazione
        const transactionIntent = {
          tokenAddress: this.tokenAddress.toString(),
          expectedPrice,
          amount: mergedOptions.amount,
          sender: senderPubkey.toString(),
          timestamp: Date.now()
        };
        
        // Crea un commit
        const commitment = await this.frontRunningProtection.createCommitment(
          transactionIntent,
          senderPubkey
        );
        
        results.verifications.commitReveal = {
          commitHash: commitment.commitHash,
          nonce: commitment.nonce,
          expiresAt: commitment.expiresAt,
          minRevealSlot: commitment.minRevealSlot
        };
      }
      
      // Offusca la transazione se abilitato
      if (mergedOptions.useTransactionObfuscation) {
        const nonce = this.frontRunningProtection.generateNonce();
        const obfuscatedTx = this.frontRunningProtection.obfuscateTransaction(
          transaction,
          nonce
        );
        
        results.verifications.obfuscation = {
          transactionId: obfuscatedTx.transactionId,
          nonce: obfuscatedTx.nonce
        };
      }
      
      // Usa la protezione MEV se abilitata
      if (mergedOptions.useMevProtection) {
        // Crea una transazione privata
        if (FRONT_RUNNING_PROTECTION.MEV_PROTECTION.PRIVATE_TRANSACTIONS_ENABLED) {
          const privateTx = await this.frontRunningProtection.createPrivateTransaction(
            transaction,
            senderPubkey
          );
          
          results.verifications.mevProtection = {
            privateTransaction: privateTx.success,
            transactionId: privateTx.transactionId
          };
        }
        
        // Raggruppa le transazioni se abilitato e se ci sono più transazioni
        if (FRONT_RUNNING_PROTECTION.MEV_PROTECTION.BUNDLE_TRANSACTIONS && options.relatedTransactions) {
          const allTransactions = [transaction, ...options.relatedTransactions];
          const bundle = await this.frontRunningProtection.bundleTransactions(
            allTransactions,
            senderPubkey
          );
          
          results.verifications.mevProtection = {
            ...results.verifications.mevProtection,
            bundled: bundle.success,
            bundleId: bundle.bundleId,
            transactionCount: bundle.transactionCount
          };
        }
      }
      
      results.success = true;
      return results;
    } catch (error) {
      this.logError('verifyTransaction', error, { 
        sender: sender?.toString(),
        expectedPrice
      });
      
      return {
        success: false,
        error: error.message,
        tokenAddress: this.tokenAddress.toString()
      };
    }
  }
  
  // Esegui una transazione con protezione anti-front-running
  async executeProtectedTransaction(transaction, expectedPrice, sender, options = {}) {
    try {
      // Verifica la transazione
      const verificationResults = await this.verifyTransaction(
        transaction,
        expectedPrice,
        sender,
        options
      );
      
      // Se la verifica fallisce, restituisci l'errore
      if (!verificationResults.success) {
        return verificationResults;
      }
      
      // In un'implementazione reale, qui eseguiremmo la transazione
      // Per questa simulazione, restituiamo solo i risultati della verifica
      
      return {
        ...verificationResults,
        executed: true,
        executedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logError('executeProtectedTransaction', error, { 
        sender: sender?.toString(),
        expectedPrice
      });
      
      return {
        success: false,
        error: error.message,
        tokenAddress: this.tokenAddress.toString()
      };
    }
  }
  
  // Ottieni statistiche sull'Anti-Rug System
  getStats() {
    try {
      return {
        tokenAddress: this.tokenAddress.toString(),
        riskScore: this.riskScore,
        lastAssessment: this.lastAssessment?.toISOString(),
        isMonitoring: !!this.monitoringInterval,
        alertSubscribers: this.alertSubscribers.length,
        frontRunningProtection: this.frontRunningProtection.getStats(),
        errorCount: this.errorLog.length
      };
    } catch (error) {
      this.logError('getStats', error);
      throw error;
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
}

// Funzione per deployare l'Anti-Rug System
async function deployAntiRugSystem(tokenAddress) {
  console.log('Iniziando il deployment dell\'Anti-Rug System...');
  
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
    
    // Crea un'istanza dell'Anti-Rug System
    const antiRugSystem = new AntiRugSystem(connection, tokenPubkey);
    
    // Dati di esempio per il token
    const tokenData = {
      liquidityPercentage: 60, // 60% di liquidità rispetto alla market cap
      tokenConcentration: 15, // 15% dei token nei wallet principali
      contractAudit: true, // Il contratto è stato sottoposto ad audit
      teamDoxxed: true, // Il team è identificato pubblicamente
      socialMediaPresence: true // Il progetto ha una presenza sui social media
    };
    
    // Calcola il punteggio di rischio iniziale
    const initialRiskScore = await antiRugSystem.calculateRiskScore(tokenData);
    
    // Salva le informazioni dell'Anti-Rug System
    const antiRugSystemInfo = {
      tokenAddress: tokenPubkey.toString(),
      riskThreshold: RISK_THRESHOLD,
      monitoringInterval: MONITORING_INTERVAL,
      initialRiskScore,
      riskFactors: RISK_FACTORS,
      frontRunningProtection: FRONT_RUNNING_PROTECTION,
      deploymentTimestamp: new Date().toISOString(),
      deployer: walletKeypair.publicKey.toString()
    };
    
    // Salva le informazioni in un file JSON
    const infoPath = path.join(__dirname, '../deployment-info/anti_rug_system_info.json');
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify(antiRugSystemInfo, null, 2));
    
    console.log(`Anti-Rug System deployato con successo per il token: ${tokenPubkey.toString()}`);
    console.log(`Punteggio di rischio iniziale: ${initialRiskScore}/${MAX_RISK_SCORE}`);
    console.log(`Informazioni salvate in: ${infoPath}`);
    
    return antiRugSystemInfo;
  } catch (error) {
    console.error('Errore durante il deployment dell\'Anti-Rug System:', error);
    throw error;
  }
}

// Esporta la classe e la funzione di deployment
module.exports = {
  AntiRugSystem,
  deployAntiRugSystem,
  FrontRunningProtection,
  FRONT_RUNNING_PROTECTION
};

// Se eseguito direttamente, esegui il deployment
if (require.main === module) {
  // Prendi l'indirizzo del token come argomento
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.error('Errore: Indirizzo del token non specificato');
    console.log('Uso: node anti_rug_system.js <indirizzo_token>');
    process.exit(1);
  }
  
  deployAntiRugSystem(tokenAddress)
    .then(info => {
      console.log('Anti-Rug System deployato con successo!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Errore durante il deployment dell\'Anti-Rug System:', error);
      process.exit(1);
    });
}
