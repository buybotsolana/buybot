// Bundle Engine Program per Solana (Versione migliorata)
// Questo programma aggrega le richieste di swap in un'unica transazione con ottimizzazioni

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// Configurazione ottimizzata
const BUNDLE_SIZE = 10; // Aumentato per migliorare l'efficienza
const BUNDLE_MIN_SIZE = 3; // Dimensione minima per l'esecuzione immediata
const BUNDLE_TIMEOUT = 30000; // Ridotto a 30 secondi per migliorare la reattività
const DYNAMIC_TIMEOUT = true; // Timeout dinamico basato sul carico
const FEE_PERCENTAGE = 0.1; // 0.1% di fee per il servizio
const MAX_AMOUNT = 1000000000000; // Limite massimo per l'importo di una singola transazione
const MAX_WORKER_THREADS = Math.max(1, os.cpus().length - 1); // Usa tutti i core disponibili tranne uno
const PRIORITY_FEE_MICROLAMPORTS = 10000; // Fee di priorità per le transazioni

// Configurazione di sicurezza
const AUTHORITY_CONFIG = {
  // Ruoli e permessi
  ROLES: {
    ADMIN: 'admin',       // Può eseguire tutte le operazioni
    OPERATOR: 'operator', // Può eseguire bundle e gestire richieste
    USER: 'user'          // Può solo inviare richieste
  },
  // Operazioni consentite
  OPERATIONS: {
    EXECUTE_BUNDLE: 'execute_bundle',
    ADD_REQUEST: 'add_request',
    MODIFY_CONFIG: 'modify_config',
    VIEW_STATS: 'view_stats'
  },
  // Matrice di permessi per ruolo
  PERMISSIONS: {
    'admin': ['execute_bundle', 'add_request', 'modify_config', 'view_stats'],
    'operator': ['execute_bundle', 'add_request', 'view_stats'],
    'user': ['add_request', 'view_stats']
  }
};

// Classe per la gestione sicura delle operazioni aritmetiche
class SafeMath {
  static add(a, b) {
    const result = a + b;
    if (result < a || result < b) {
      console.warn('Rilevato potenziale overflow nella somma, limitando il risultato');
      return Number.MAX_SAFE_INTEGER;
    }
    return result;
  }

  static subtract(a, b) {
    if (b > a) {
      console.warn('Rilevato potenziale underflow nella sottrazione, limitando il risultato a 0');
      return 0;
    }
    return a - b;
  }

  static multiply(a, b) {
    if (a === 0 || b === 0) return 0;
    
    const result = a * b;
    if (result / a !== b || result / b !== a) {
      console.warn('Rilevato potenziale overflow nella moltiplicazione, limitando il risultato');
      return Number.MAX_SAFE_INTEGER;
    }
    return result;
  }

  static divide(a, b) {
    if (b === 0) {
      console.warn('Tentativo di divisione per zero, restituendo 0');
      return 0;
    }
    return a / b;
  }

  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  static percentage(value, percentage) {
    return this.multiply(value, this.divide(percentage, 100));
  }
}

// Classe per la gestione dell'autorizzazione
class AuthorityManager {
  constructor(programAuthority) {
    if (!programAuthority) {
      throw new Error('Program authority non può essere null o undefined');
    }
    
    try {
      // Verifica che programAuthority sia una PublicKey valida
      this.programAuthority = new PublicKey(programAuthority);
    } catch (error) {
      throw new Error(`Program authority non valida: ${error.message}`);
    }
    
    this.authorizedUsers = new Map(); // Mappa degli utenti autorizzati e i loro ruoli
    this.signatureCache = new Map(); // Cache delle firme verificate
    this.signatureCacheTTL = 300000; // TTL della cache (5 minuti)
    this.lastCacheCleanup = Date.now();
    
    // Aggiungi l'autorità del programma come admin
    this.addAuthorizedUser(this.programAuthority.toString(), AUTHORITY_CONFIG.ROLES.ADMIN);
    
    console.log(`Authority Manager inizializzato con program authority: ${this.programAuthority.toString()}`);
  }
  
  // Aggiunge un utente autorizzato
  addAuthorizedUser(userAddress, role) {
    if (!userAddress || !role) {
      throw new Error('userAddress e role non possono essere null o undefined');
    }
    
    if (!Object.values(AUTHORITY_CONFIG.ROLES).includes(role)) {
      throw new Error(`Ruolo non valido: ${role}. Ruoli validi: ${Object.values(AUTHORITY_CONFIG.ROLES).join(', ')}`);
    }
    
    try {
      // Verifica che userAddress sia una PublicKey valida
      const userPubkey = new PublicKey(userAddress);
      this.authorizedUsers.set(userPubkey.toString(), {
        role,
        addedAt: Date.now()
      });
      
      console.log(`Utente autorizzato aggiunto: ${userPubkey.toString()} con ruolo ${role}`);
      return true;
    } catch (error) {
      throw new Error(`Indirizzo utente non valido: ${error.message}`);
    }
  }
  
  // Rimuove un utente autorizzato
  removeAuthorizedUser(userAddress) {
    if (!userAddress) {
      throw new Error('userAddress non può essere null o undefined');
    }
    
    try {
      // Verifica che userAddress sia una PublicKey valida
      const userPubkey = new PublicKey(userAddress);
      
      // Non permettere la rimozione dell'autorità del programma
      if (userPubkey.equals(this.programAuthority)) {
        throw new Error('Non è possibile rimuovere l\'autorità del programma');
      }
      
      const removed = this.authorizedUsers.delete(userPubkey.toString());
      
      if (removed) {
        console.log(`Utente autorizzato rimosso: ${userPubkey.toString()}`);
      } else {
        console.log(`Utente non trovato: ${userPubkey.toString()}`);
      }
      
      return removed;
    } catch (error) {
      throw new Error(`Errore durante la rimozione dell'utente: ${error.message}`);
    }
  }
  
  // Verifica se un utente è autorizzato per un'operazione
  isAuthorized(userAddress, operation) {
    if (!userAddress || !operation) {
      return false;
    }
    
    try {
      // Verifica che userAddress sia una PublicKey valida
      const userPubkey = userAddress instanceof PublicKey ? userAddress : new PublicKey(userAddress);
      
      // Verifica se l'utente è autorizzato
      const userInfo = this.authorizedUsers.get(userPubkey.toString());
      
      if (!userInfo) {
        return false;
      }
      
      // Verifica se il ruolo dell'utente ha il permesso per l'operazione
      const permissions = AUTHORITY_CONFIG.PERMISSIONS[userInfo.role];
      
      return permissions && permissions.includes(operation);
    } catch (error) {
      console.error(`Errore durante la verifica dell'autorizzazione: ${error.message}`);
      return false;
    }
  }
  
  // Verifica una firma
  async verifySignature(message, signature, publicKey, connection) {
    if (!message || !signature || !publicKey || !connection) {
      return false;
    }
    
    try {
      // Crea una chiave di cache
      const cacheKey = `${publicKey.toString()}-${signature}-${message}`;
      
      // Verifica se la firma è nella cache
      if (this.signatureCache.has(cacheKey)) {
        const cachedResult = this.signatureCache.get(cacheKey);
        
        // Verifica se la cache è ancora valida
        if (Date.now() - cachedResult.timestamp < this.signatureCacheTTL) {
          return cachedResult.isValid;
        }
        
        // Rimuovi la cache scaduta
        this.signatureCache.delete(cacheKey);
      }
      
      // Pulisci la cache se necessario
      this.cleanupSignatureCache();
      
      // Verifica la firma
      // In un'implementazione reale, utilizzeremmo le API di Solana per verificare la firma
      // Qui simuliamo la verifica
      const isValid = true; // Simulazione di verifica riuscita
      
      // Aggiungi il risultato alla cache
      this.signatureCache.set(cacheKey, {
        isValid,
        timestamp: Date.now()
      });
      
      return isValid;
    } catch (error) {
      console.error(`Errore durante la verifica della firma: ${error.message}`);
      return false;
    }
  }
  
  // Pulisce la cache delle firme
  cleanupSignatureCache() {
    const now = Date.now();
    
    // Pulisci la cache solo ogni minuto
    if (now - this.lastCacheCleanup < 60000) {
      return;
    }
    
    this.lastCacheCleanup = now;
    
    // Rimuovi le firme scadute
    for (const [key, value] of this.signatureCache.entries()) {
      if (now - value.timestamp > this.signatureCacheTTL) {
        this.signatureCache.delete(key);
      }
    }
    
    console.log(`Cache delle firme pulita. Dimensione attuale: ${this.signatureCache.size}`);
  }
  
  // Ottieni statistiche sull'autorizzazione
  getStats() {
    const usersByRole = {};
    
    // Conta gli utenti per ruolo
    for (const [userAddress, userInfo] of this.authorizedUsers.entries()) {
      const role = userInfo.role;
      
      if (!usersByRole[role]) {
        usersByRole[role] = [];
      }
      
      usersByRole[role].push({
        address: userAddress,
        addedAt: userInfo.addedAt
      });
    }
    
    return {
      programAuthority: this.programAuthority.toString(),
      authorizedUsers: this.authorizedUsers.size,
      usersByRole,
      signatureCacheSize: this.signatureCache.size,
      signatureCacheTTL: this.signatureCacheTTL,
      lastCacheCleanup: this.lastCacheCleanup
    };
  }
}

// Classe per la gestione ottimizzata delle transazioni
class TransactionOptimizer {
  constructor() {
    this.transactionGroups = new Map(); // Raggruppa le transazioni per mittente
    this.priorityQueue = []; // Coda di priorità per le transazioni
  }

  // Aggiunge una transazione alla coda di ottimizzazione
  addTransaction(transaction) {
    // Assegna una priorità alla transazione in base all'importo e al timestamp
    const priority = this.calculatePriority(transaction);
    transaction.priority = priority;
    
    // Aggiungi alla coda di priorità
    this.priorityQueue.push(transaction);
    this.priorityQueue.sort((a, b) => b.priority - a.priority);
    
    // Raggruppa per mittente per ottimizzare le firme
    const senderKey = transaction.fromWallet.toString();
    if (!this.transactionGroups.has(senderKey)) {
      this.transactionGroups.set(senderKey, []);
    }
    this.transactionGroups.get(senderKey).push(transaction);
    
    return priority;
  }

  // Calcola la priorità di una transazione
  calculatePriority(transaction) {
    // Formula: (importo * 0.7) + (1 / età in ms * 0.3)
    const amount = transaction.amount;
    const age = Date.now() - transaction.timestamp;
    const amountFactor = Math.min(1, amount / 1000000) * 0.7;
    const ageFactor = Math.min(1, 1 / (age + 1) * 10000) * 0.3;
    
    return amountFactor + ageFactor;
  }

  // Ottiene le transazioni ottimizzate per l'esecuzione
  getOptimizedTransactions(maxCount) {
    // Prendi le transazioni con priorità più alta
    return this.priorityQueue.slice(0, maxCount);
  }

  // Ottiene gruppi di transazioni per mittente
  getTransactionGroups() {
    return this.transactionGroups;
  }

  // Rimuove le transazioni dalla coda
  removeTransactions(transactionIds) {
    // Rimuovi dalla coda di priorità
    this.priorityQueue = this.priorityQueue.filter(tx => !transactionIds.includes(tx.id));
    
    // Rimuovi dai gruppi
    for (const [sender, transactions] of this.transactionGroups.entries()) {
      this.transactionGroups.set(
        sender,
        transactions.filter(tx => !transactionIds.includes(tx.id))
      );
      
      // Rimuovi gruppi vuoti
      if (this.transactionGroups.get(sender).length === 0) {
        this.transactionGroups.delete(sender);
      }
    }
  }
}

// Classe principale del Bundle Engine migliorato
class BundleEngineImproved {
  constructor(connection, tokenAddress, keypairPath = null) {
    this.connection = connection;
    this.tokenAddress = new PublicKey(tokenAddress);
    this.pendingTransactions = [];
    this.executedBundles = [];
    this.bundleInProgress = false;
    this.workers = [];
    this.keypairPath = keypairPath || path.join(process.env.HOME, '.config', 'solana', 'id.json');
    
    // Inizializza il timer per il bundle
    this.bundleTimer = null;
    
    // Inizializza l'ottimizzatore di transazioni
    this.transactionOptimizer = new TransactionOptimizer();
    
    // Inizializza i worker threads per il parallelismo
    this.initializeWorkers();
    
    // Carica il wallet
    this.loadWallet();
    
    console.log(`Bundle Engine migliorato inizializzato per il token: ${tokenAddress}`);
    console.log(`Dimensione bundle: ${BUNDLE_SIZE}, Timeout: ${BUNDLE_TIMEOUT}ms, Fee: ${FEE_PERCENTAGE}%`);
    console.log(`Worker threads: ${MAX_WORKER_THREADS}`);
  }
  
  // Inizializza i worker threads per il parallelismo
  initializeWorkers() {
    if (isMainThread) {
      for (let i = 0; i < MAX_WORKER_THREADS; i++) {
        const worker = new Worker(__filename, {
          workerData: { workerId: i }
        });
        
        worker.on('message', (message) => {
          if (message.type === 'transaction_result') {
            this.handleWorkerResult(message.data);
          }
        });
        
        worker.on('error', (error) => {
          console.error(`Errore nel worker ${i}:`, error);
        });
        
        this.workers.push(worker);
      }
      
      console.log(`Inizializzati ${this.workers.length} worker threads`);
    }
  }
  
  // Gestisce i risultati dai worker threads
  handleWorkerResult(result) {
    if (result.success) {
      console.log(`Worker ha completato la transazione ${result.transactionId} con successo`);
      
      // Aggiorna le statistiche
      this.executedBundles.push({
        id: result.bundleId,
        signature: result.signature,
        timestamp: result.timestamp,
        transactions: result.transactions
      });
    } else {
      console.error(`Worker ha fallito la transazione ${result.transactionId}:`, result.error);
    }
  }
  
  // Carica il wallet da file
  loadWallet() {
    try {
      const walletData = JSON.parse(fs.readFileSync(this.keypairPath, 'utf8'));
      this.wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
      console.log(`Wallet caricato: ${this.wallet.publicKey.toString()}`);
    } catch (error) {
      console.error('Errore durante il caricamento del wallet:', error);
      throw new Error(`Impossibile caricare il wallet da ${this.keypairPath}: ${error.message}`);
    }
  }
  
  // Aggiunge una transazione al bundle con supporto per keypair del mittente
  async addTransaction(fromKeypair, toWallet, amount) {
    // Validazione degli input
    if (!fromKeypair || !toWallet || !amount) {
      throw new Error('Parametri mancanti: fromKeypair, toWallet e amount sono obbligatori');
    }
    
    if (amount <= 0 || amount > MAX_AMOUNT) {
      throw new Error(`L'importo deve essere positivo e non superiore a ${MAX_AMOUNT}`);
    }
    
    let fromWallet;
    if (fromKeypair instanceof Keypair) {
      fromWallet = fromKeypair.publicKey;
    } else if (fromKeypair instanceof PublicKey) {
      fromWallet = fromKeypair;
    } else {
      try {
        // Prova a interpretare come stringa di chiave pubblica
        fromWallet = new PublicKey(fromKeypair);
      } catch (error) {
        throw new Error(`Formato non valido per fromKeypair: ${error.message}`);
      }
    }
    
    // Crea un ID univoco per la transazione
    const transactionId = crypto.randomBytes(16).toString('hex');
    
    // Crea l'oggetto transazione
    const transaction = {
      id: transactionId,
      fromWallet: fromWallet,
      fromKeypair: fromKeypair instanceof Keypair ? fromKeypair : null,
      toWallet: new PublicKey(toWallet),
      amount,
      timestamp: Date.now()
    };
    
    // Aggiungi la transazione all'ottimizzatore
    const priority = this.transactionOptimizer.addTransaction(transaction);
    
    // Aggiungi la transazione alla coda
    this.pendingTransactions.push(transaction);
    
    console.log(`Transazione aggiunta al bundle: ${transactionId} (priorità: ${priority.toFixed(4)})`);
    console.log(`Da: ${fromWallet.toString()}`);
    console.log(`A: ${toWallet.toString()}`);
    console.log(`Importo: ${amount}`);
    
    // Verifica se dobbiamo eseguire il bundle immediatamente
    if (this.pendingTransactions.length >= BUNDLE_MIN_SIZE && !this.bundleInProgress) {
      // Se abbiamo raggiunto la dimensione minima, verifica se è conveniente eseguire subito
      if (this.pendingTransactions.length >= BUNDLE_SIZE || this.shouldExecuteEarly()) {
        this.executeBundleTransactions();
      } else if (!this.bundleTimer) {
        // Altrimenti, imposta un timer per eseguire il bundle dopo il timeout
        const timeout = this.calculateDynamicTimeout();
        this.bundleTimer = setTimeout(() => {
          if (this.pendingTransactions.length > 0 && !this.bundleInProgress) {
            this.executeBundleTransactions();
          }
        }, timeout);
        
        console.log(`Timer impostato per l'esecuzione del bundle tra ${timeout}ms`);
      }
    }
    
    return {
      transactionId,
      priority,
      pendingTransactions: this.pendingTransactions.length,
      estimatedExecutionTime: this.bundleTimer ? 
        Math.max(0, BUNDLE_TIMEOUT - (Date.now() - this.pendingTransactions[0].timestamp)) : 
        0
    };
  }
  
  // Calcola un timeout dinamico in base al carico
  calculateDynamicTimeout() {
    if (!DYNAMIC_TIMEOUT) {
      return BUNDLE_TIMEOUT;
    }
    
    // Calcola il timeout in base al numero di transazioni in attesa
    const pendingRatio = this.pendingTransactions.length / BUNDLE_SIZE;
    const minTimeout = BUNDLE_TIMEOUT * 0.2; // Minimo 20% del timeout standard
    const dynamicTimeout = BUNDLE_TIMEOUT * (1 - pendingRatio * 0.8);
    
    return Math.max(minTimeout, dynamicTimeout);
  }
  
  // Verifica se è conveniente eseguire il bundle prima del timeout
  shouldExecuteEarly() {
    // Se abbiamo almeno il 70% della dimensione massima del bundle, esegui subito
    if (this.pendingTransactions.length >= BUNDLE_SIZE * 0.7) {
      return true;
    }
    
    // Se ci sono transazioni ad alta priorità, esegui subito
    const highPriorityThreshold = 0.8;
    const highPriorityTransactions = this.pendingTransactions.filter(tx => tx.priority > highPriorityThreshold);
    if (highPriorityTransactions.length >= BUNDLE_MIN_SIZE) {
      return true;
    }
    
    return false;
  }
  
  // Esegue le transazioni in bundle con parallelismo
  async executeBundleTransactions() {
    if (this.pendingTransactions.length === 0 || this.bundleInProgress) {
      return;
    }
    
    this.bundleInProgress = true;
    
    // Cancella il timer se esiste
    if (this.bundleTimer) {
      clearTimeout(this.bundleTimer);
      this.bundleTimer = null;
    }
    
    console.log(`Esecuzione del bundle con ${this.pendingTransactions.length} transazioni`);
    
    try {
      // Ottieni le transazioni ottimizzate
      const transactionsToExecute = this.transactionOptimizer.getOptimizedTransactions(
        Math.min(this.pendingTransactions.length, BUNDLE_SIZE)
      );
      
      console.log(`Transazioni ottimizzate: ${transactionsToExecute.length}`);
      
      // Crea un ID univoco per il bundle
      const bundleId = crypto.randomBytes(16).toString('hex');
      
      // Distribuisci le transazioni ai worker threads
      const transactionIds = transactionsToExecute.map(tx => tx.id);
      
      // Rimuovi le transazioni dalla coda
      this.transactionOptimizer.removeTransactions(transactionIds);
      this.pendingTransactions = this.pendingTransactions.filter(tx => !transactionIds.includes(tx.id));
      
      // Se non ci sono worker threads disponibili, esegui in modo sincrono
      if (this.workers.length === 0) {
        await this.executeTransactionsSync(bundleId, transactionsToExecute);
      } else {
        // Altrimenti, distribuisci ai worker threads
        this.distributeTransactionsToWorkers(bundleId, transactionsToExecute);
      }
      
      return {
        bundleId,
        transactionCount: transactionsToExecute.length
      };
    } catch (error) {
      console.error('Errore durante l\'esecuzione del bundle:', error);
      this.bundleInProgress = false;
      throw error;
    } finally {
      this.bundleInProgress = false;
    }
  }
  
  // Esegue le transazioni in modo sincrono (fallback)
  async executeTransactionsSync(bundleId, transactions) {
    console.log(`Esecuzione sincrona del bundle ${bundleId} con ${transactions.length} transazioni`);
    
    for (const transaction of transactions) {
      try {
        // Crea e invia la transazione
        const { signature } = await this.createAndSendTransaction(transaction);
        
        console.log(`Transazione ${transaction.id} completata con successo. Firma: ${signature}`);
        
        // Aggiorna le statistiche
        this.executedBundles.push({
          id: bundleId,
          signature,
          timestamp: Date.now(),
          transactions: [transaction]
        });
      } catch (error) {
        console.error(`Errore durante l'esecuzione della transazione ${transaction.id}:`, error);
      }
    }
  }
  
  // Distribuisce le transazioni ai worker threads
  distributeTransactionsToWorkers(bundleId, transactions) {
    console.log(`Distribuzione di ${transactions.length} transazioni ai worker threads`);
    
    // Distribuisci le transazioni in modo uniforme ai worker threads
    const transactionsPerWorker = Math.ceil(transactions.length / this.workers.length);
    
    for (let i = 0; i < this.workers.length && transactions.length > 0; i++) {
      const workerTransactions = transactions.splice(0, transactionsPerWorker);
      
      if (workerTransactions.length > 0) {
        this.workers[i].postMessage({
          type: 'execute_transactions',
          data: {
            bundleId,
            transactions: workerTransactions,
            tokenAddress: this.tokenAddress.toString(),
            rpcUrl: this.connection.rpcEndpoint
          }
        });
        
        console.log(`Inviate ${workerTransactions.length} transazioni al worker ${i}`);
      }
    }
  }
  
  // Crea e invia una transazione
  async createAndSendTransaction(transaction) {
    // Ottieni gli account associati al token
    const fromTokenAccount = await getAssociatedTokenAddress(
      this.tokenAddress,
      transaction.fromWallet
    );
    
    const toTokenAccount = await getAssociatedTokenAddress(
      this.tokenAddress,
      transaction.toWallet
    );
    
    // Verifica se l'account di destinazione esiste
    let toTokenAccountInfo;
    try {
      toTokenAccountInfo = await this.connection.getAccountInfo(toTokenAccount);
    } catch (error) {
      console.error(`Errore durante la verifica dell'account di destinazione:`, error);
      throw new Error(`Impossibile verificare l'account di destinazione: ${error.message}`);
    }
    
    // Crea una nuova transazione
    const tx = new Transaction();
    
    // Aggiungi istruzioni per la fee di priorità
    const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PRIORITY_FEE_MICROLAMPORTS
    });
    tx.add(priorityFeeInstruction);
    
    // Se l'account di destinazione non esiste, crea un'istruzione per crearlo
    if (!toTokenAccountInfo) {
      const createAccountInstruction = createAssociatedTokenAccountInstruction(
        this.wallet.publicKey, // payer
        toTokenAccount, // associatedToken
        transaction.toWallet, // owner
        this.tokenAddress // mint
      );
      tx.add(createAccountInstruction);
    }
    
    // Crea l'istruzione di trasferimento
    const transferInstruction = createTransferInstruction(
      fromTokenAccount, // source
      toTokenAccount, // destination
      transaction.fromWallet, // owner
      transaction.amount // amount
    );
    tx.add(transferInstruction);
    
    // Firma e invia la transazione
    let signature;
    try {
      // Se abbiamo il keypair del mittente, usa quello per firmare
      if (transaction.fromKeypair) {
        signature = await sendAndConfirmTransaction(
          this.connection,
          tx,
          [transaction.fromKeypair, this.wallet]
        );
      } else {
        // Altrimenti, usa solo il wallet del bundle engine
        signature = await sendAndConfirmTransaction(
          this.connection,
          tx,
          [this.wallet]
        );
      }
    } catch (error) {
      console.error(`Errore durante l'invio della transazione:`, error);
      throw new Error(`Impossibile inviare la transazione: ${error.message}`);
    }
    
    return { signature };
  }
  
  // Ottiene le statistiche del bundle engine
  getStats() {
    return {
      pendingTransactions: this.pendingTransactions.length,
      executedBundles: this.executedBundles.length,
      totalTransactionsExecuted: this.executedBundles.reduce((total, bundle) => total + bundle.transactions.length, 0),
      bundleInProgress: this.bundleInProgress,
      workerCount: this.workers.length,
      nextBundleTime: this.bundleTimer ? Date.now() + (BUNDLE_TIMEOUT - (Date.now() - this.pendingTransactions[0]?.timestamp || 0)) : null
    };
  }
  
  // Chiude il bundle engine e i worker threads
  close() {
    // Cancella il timer se esiste
    if (this.bundleTimer) {
      clearTimeout(this.bundleTimer);
      this.bundleTimer = null;
    }
    
    // Termina i worker threads
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    console.log(`Bundle Engine chiuso. Transazioni in attesa: ${this.pendingTransactions.length}`);
  }
}

// Codice per i worker threads
if (!isMainThread) {
  // Gestione dei messaggi nel worker thread
  parentPort.on('message', async (message) => {
    if (message.type === 'execute_transactions') {
      const { bundleId, transactions, tokenAddress, rpcUrl } = message.data;
      
      console.log(`Worker ${workerData.workerId}: Ricevute ${transactions.length} transazioni da eseguire`);
      
      // Crea una connessione per il worker
      const connection = new Connection(rpcUrl, 'confirmed');
      
      // Esegui le transazioni
      for (const transaction of transactions) {
        try {
          // Simula l'esecuzione della transazione (in un'implementazione reale, eseguiremmo la transazione)
          await new Promise(resolve => setTimeout(resolve, 100)); // Simula il tempo di esecuzione
          
          // Invia il risultato al thread principale
          parentPort.postMessage({
            type: 'transaction_result',
            data: {
              success: true,
              bundleId,
              transactionId: transaction.id,
              signature: 'simulated_signature_' + transaction.id,
              timestamp: Date.now(),
              transactions: [transaction]
            }
          });
        } catch (error) {
          // Invia l'errore al thread principale
          parentPort.postMessage({
            type: 'transaction_result',
            data: {
              success: false,
              bundleId,
              transactionId: transaction.id,
              error: error.message || 'Errore sconosciuto'
            }
          });
        }
      }
    }
  });
  
  console.log(`Worker ${workerData.workerId} inizializzato`);
}

// Esporta la classe
module.exports = {
  BundleEngineImproved,
  SafeMath,
  TransactionOptimizer,
  AuthorityManager
};
