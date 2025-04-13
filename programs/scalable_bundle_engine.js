// Bundle Engine Scalabile per Solana
// Implementa meccanismi di auto-scaling e distribuzione del carico

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram, TransactionInstruction, ComputeBudgetProgram } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const cluster = require('cluster');

// Importa i moduli di sicurezza
const SecureWalletManager = require('../wallet/secure_wallet_manager');
const ReentrancyGuard = require('./reentrancy_guard');
const SignatureVerifier = require('./signature_verifier');

// Configurazione ottimizzata
const BUNDLE_SIZE = 10; // Dimensione del bundle
const BUNDLE_MIN_SIZE = 3; // Dimensione minima per l'esecuzione immediata
const BUNDLE_TIMEOUT = 30000; // Timeout in ms
const DYNAMIC_TIMEOUT = true; // Timeout dinamico
const FEE_PERCENTAGE = 0.1; // Fee percentuale
const MAX_AMOUNT = 1000000000000; // Limite massimo per l'importo di una singola transazione
const MAX_WORKER_THREADS = Math.max(1, os.cpus().length - 1); // Worker threads
const PRIORITY_FEE_MICROLAMPORTS = 10000; // Fee di priorità

// Configurazione di scalabilità
const SCALING_CONFIG = {
  // Auto-scaling
  AUTO_SCALING: {
    ENABLED: true,
    MIN_WORKERS: 1,
    MAX_WORKERS: os.cpus().length,
    SCALE_UP_THRESHOLD: 0.7, // Carico CPU per lo scale up
    SCALE_DOWN_THRESHOLD: 0.3, // Carico CPU per lo scale down
    SCALE_CHECK_INTERVAL: 30000, // Intervallo di controllo in ms (30 secondi)
    COOLDOWN_PERIOD: 60000 // Periodo di cooldown in ms (1 minuto)
  },
  // Distribuzione del carico
  LOAD_BALANCING: {
    ENABLED: true,
    STRATEGY: 'round_robin', // Strategia di bilanciamento: 'round_robin', 'least_connections', 'weighted'
    HEALTH_CHECK_INTERVAL: 10000, // Intervallo di controllo della salute in ms (10 secondi)
    RETRY_COUNT: 3, // Numero di tentativi in caso di fallimento
    RETRY_DELAY: 1000 // Ritardo tra i tentativi in ms (1 secondo)
  },
  // Sharding
  SHARDING: {
    ENABLED: true,
    SHARD_COUNT: Math.max(1, Math.floor(os.cpus().length / 2)), // Numero di shard
    SHARD_BY: 'sender', // Criterio di sharding: 'sender', 'receiver', 'amount'
    REBALANCE_INTERVAL: 300000 // Intervallo di ribilanciamento in ms (5 minuti)
  },
  // Caching
  CACHING: {
    ENABLED: true,
    TTL: 300000, // Time-to-live in ms (5 minuti)
    MAX_SIZE: 1000, // Dimensione massima della cache
    PRUNE_INTERVAL: 60000 // Intervallo di pulizia in ms (1 minuto)
  },
  // Throttling
  THROTTLING: {
    ENABLED: true,
    MAX_REQUESTS_PER_SECOND: 100, // Massimo numero di richieste al secondo
    MAX_REQUESTS_PER_IP: 20, // Massimo numero di richieste per IP
    WINDOW_MS: 60000, // Finestra di tempo in ms (1 minuto)
    BLOCK_DURATION: 300000 // Durata del blocco in ms (5 minuti)
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

// Classe per la gestione della cache
class CacheManager {
  constructor(config = {}) {
    this.ttl = config.TTL || 300000; // 5 minuti
    this.maxSize = config.MAX_SIZE || 1000;
    this.pruneInterval = config.PRUNE_INTERVAL || 60000; // 1 minuto
    this.cache = new Map();
    this.lastPruneTime = Date.now();
    
    // Avvia il timer per la pulizia periodica
    if (this.pruneInterval > 0) {
      setInterval(() => this.prune(), this.pruneInterval);
    }
  }
  
  // Ottiene un valore dalla cache
  get(key) {
    if (!this.cache.has(key)) {
      return null;
    }
    
    const item = this.cache.get(key);
    
    // Verifica se l'elemento è scaduto
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    // Aggiorna il timestamp di ultimo accesso
    item.lastAccessed = Date.now();
    
    return item.value;
  }
  
  // Imposta un valore nella cache
  set(key, value, ttl = null) {
    // Pulisci la cache se necessario
    if (this.cache.size >= this.maxSize) {
      this.prune(true);
    }
    
    // Calcola il timestamp di scadenza
    const expiresAt = Date.now() + (ttl || this.ttl);
    
    // Memorizza il valore nella cache
    this.cache.set(key, {
      value,
      expiresAt,
      lastAccessed: Date.now()
    });
    
    return true;
  }
  
  // Elimina un valore dalla cache
  delete(key) {
    return this.cache.delete(key);
  }
  
  // Pulisce la cache
  prune(force = false) {
    const now = Date.now();
    
    // Pulisci la cache solo se è passato abbastanza tempo dall'ultima pulizia
    if (!force && now - this.lastPruneTime < this.pruneInterval) {
      return;
    }
    
    this.lastPruneTime = now;
    
    // Rimuovi gli elementi scaduti
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
    
    // Se la cache è ancora troppo grande, rimuovi gli elementi meno recentemente utilizzati
    if (this.cache.size > this.maxSize) {
      const items = Array.from(this.cache.entries())
        .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
      
      const itemsToRemove = items.slice(0, items.length - this.maxSize);
      
      for (const [key] of itemsToRemove) {
        this.cache.delete(key);
      }
    }
  }
  
  // Ottiene le statistiche della cache
  getStats() {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const item of this.cache.values()) {
      if (now > item.expiresAt) {
        expiredCount++;
      }
    }
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      expiredCount,
      lastPruneTime: this.lastPruneTime
    };
  }
}

// Classe per la gestione del throttling
class ThrottlingManager {
  constructor(config = {}) {
    this.maxRequestsPerSecond = config.MAX_REQUESTS_PER_SECOND || 100;
    this.maxRequestsPerIP = config.MAX_REQUESTS_PER_IP || 20;
    this.windowMs = config.WINDOW_MS || 60000; // 1 minuto
    this.blockDuration = config.BLOCK_DURATION || 300000; // 5 minuti
    
    this.requests = new Map(); // Mappa delle richieste per IP
    this.blockedIPs = new Map(); // Mappa degli IP bloccati
    this.globalRequests = []; // Array delle richieste globali
    
    // Avvia il timer per la pulizia periodica
    setInterval(() => this.cleanup(), this.windowMs);
  }
  
  // Verifica se una richiesta è consentita
  isAllowed(ip) {
    const now = Date.now();
    
    // Verifica se l'IP è bloccato
    if (this.blockedIPs.has(ip)) {
      const blockExpiry = this.blockedIPs.get(ip);
      
      if (now < blockExpiry) {
        return false;
      }
      
      // Rimuovi il blocco se è scaduto
      this.blockedIPs.delete(ip);
    }
    
    // Verifica il limite globale
    this.globalRequests = this.globalRequests.filter(timestamp => now - timestamp < 1000);
    
    if (this.globalRequests.length >= this.maxRequestsPerSecond) {
      return false;
    }
    
    // Verifica il limite per IP
    if (!this.requests.has(ip)) {
      this.requests.set(ip, []);
    }
    
    const ipRequests = this.requests.get(ip).filter(timestamp => now - timestamp < this.windowMs);
    
    if (ipRequests.length >= this.maxRequestsPerIP) {
      // Blocca l'IP
      this.blockedIPs.set(ip, now + this.blockDuration);
      return false;
    }
    
    // Aggiorna le richieste
    this.globalRequests.push(now);
    ipRequests.push(now);
    this.requests.set(ip, ipRequests);
    
    return true;
  }
  
  // Registra una richiesta
  recordRequest(ip) {
    const now = Date.now();
    
    // Aggiorna le richieste globali
    this.globalRequests.push(now);
    
    // Aggiorna le richieste per IP
    if (!this.requests.has(ip)) {
      this.requests.set(ip, []);
    }
    
    const ipRequests = this.requests.get(ip);
    ipRequests.push(now);
    this.requests.set(ip, ipRequests);
  }
  
  // Pulisce le richieste scadute
  cleanup() {
    const now = Date.now();
    
    // Pulisci le richieste globali
    this.globalRequests = this.globalRequests.filter(timestamp => now - timestamp < 1000);
    
    // Pulisci le richieste per IP
    for (const [ip, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(timestamp => now - timestamp < this.windowMs);
      
      if (validTimestamps.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, validTimestamps);
      }
    }
    
    // Pulisci gli IP bloccati
    for (const [ip, expiry] of this.blockedIPs.entries()) {
      if (now > expiry) {
        this.blockedIPs.delete(ip);
      }
    }
  }
  
  // Ottiene le statistiche del throttling
  getStats() {
    return {
      globalRequestsCount: this.globalRequests.length,
      ipRequestsCount: this.requests.size,
      blockedIPsCount: this.blockedIPs.size,
      maxRequestsPerSecond: this.maxRequestsPerSecond,
      maxRequestsPerIP: this.maxRequestsPerIP,
      windowMs: this.windowMs,
      blockDuration: this.blockDuration
    };
  }
}

// Classe per la gestione dello sharding
class ShardManager {
  constructor(config = {}) {
    this.shardCount = config.SHARD_COUNT || 1;
    this.shardBy = config.SHARD_BY || 'sender';
    this.rebalanceInterval = config.REBALANCE_INTERVAL || 300000; // 5 minuti
    
    this.shards = new Array(this.shardCount).fill(0).map(() => ({
      transactions: [],
      load: 0
    }));
    
    this.lastRebalanceTime = Date.now();
    
    // Avvia il timer per il ribilanciamento periodico
    if (this.rebalanceInterval > 0) {
      setInterval(() => this.rebalance(), this.rebalanceInterval);
    }
  }
  
  // Assegna una transazione a uno shard
  assignToShard(transaction) {
    const shardIndex = this.getShardIndex(transaction);
    const shard = this.shards[shardIndex];
    
    shard.transactions.push(transaction);
    shard.load++;
    
    return shardIndex;
  }
  
  // Ottiene l'indice dello shard per una transazione
  getShardIndex(transaction) {
    let key;
    
    switch (this.shardBy) {
      case 'sender':
        key = transaction.fromWallet.toString();
        break;
      case 'receiver':
        key = transaction.toWallet.toString();
        break;
      case 'amount':
        key = transaction.amount.toString();
        break;
      default:
        key = transaction.id;
    }
    
    // Calcola l'hash della chiave
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    
    // Converti l'hash in un numero e calcola il modulo
    const hashNum = parseInt(hash.substring(0, 8), 16);
    return hashNum % this.shardCount;
  }
  
  // Ottiene le transazioni da uno shard
  getTransactionsFromShard(shardIndex) {
    if (shardIndex < 0 || shardIndex >= this.shardCount) {
      throw new Error(`Indice shard non valido: ${shardIndex}`);
    }
    
    return this.shards[shardIndex].transactions;
  }
  
  // Rimuove le transazioni da uno shard
  removeTransactionsFromShard(shardIndex, transactionIds) {
    if (shardIndex < 0 || shardIndex >= this.shardCount) {
      throw new Error(`Indice shard non valido: ${shardIndex}`);
    }
    
    const shard = this.shards[shardIndex];
    const initialCount = shard.transactions.length;
    
    shard.transactions = shard.transactions.filter(tx => !transactionIds.includes(tx.id));
    
    const removedCount = initialCount - shard.transactions.length;
    shard.load -= removedCount;
    
    return removedCount;
  }
  
  // Ribilancia gli shard
  rebalance() {
    const now = Date.now();
    
    // Ribilancia solo se è passato abbastanza tempo dall'ultimo ribilanciamento
    if (now - this.lastRebalanceTime < this.rebalanceInterval) {
      return;
    }
    
    this.lastRebalanceTime = now;
    
    // Calcola il carico medio
    const totalLoad = this.shards.reduce((sum, shard) => sum + shard.load, 0);
    const avgLoad = totalLoad / this.shardCount;
    
    // Identifica gli shard sovraccarichi e sottocarichi
    const overloadedShards = [];
    const underloadedShards = [];
    
    for (let i = 0; i < this.shardCount; i++) {
      const shard = this.shards[i];
      
      if (shard.load > avgLoad * 1.2) { // 20% sopra la media
        overloadedShards.push({ index: i, shard });
      } else if (shard.load < avgLoad * 0.8) { // 20% sotto la media
        underloadedShards.push({ index: i, shard });
      }
    }
    
    // Ribilancia gli shard
    for (const { index: overIndex, shard: overShard } of overloadedShards) {
      if (underloadedShards.length === 0) break;
      
      const { index: underIndex, shard: underShard } = underloadedShards.shift();
      
      // Calcola quante transazioni spostare
      const toMove = Math.floor((overShard.load - underShard.load) / 2);
      
      if (toMove <= 0) continue;
      
      // Sposta le transazioni
      const transactionsToMove = overShard.transactions.slice(0, toMove);
      overShard.transactions = overShard.transactions.slice(toMove);
      underShard.transactions = [...underShard.transactions, ...transactionsToMove];
      
      // Aggiorna il carico
      overShard.load -= toMove;
      underShard.load += toMove;
      
      console.log(`Ribilanciamento: spostate ${toMove} transazioni dallo shard ${overIndex} allo shard ${underIndex}`);
    }
  }
  
  // Ottiene le statistiche dello sharding
  getStats() {
    return {
      shardCount: this.shardCount,
      shardBy: this.shardBy,
      shards: this.shards.map((shard, index) => ({
        index,
        transactionCount: shard.transactions.length,
        load: shard.load
      })),
      lastRebalanceTime: this.lastRebalanceTime
    };
  }
}

// Classe per la gestione dell'auto-scaling
class AutoScalingManager {
  constructor(config = {}) {
    this.enabled = config.ENABLED || true;
    this.minWorkers = config.MIN_WORKERS || 1;
    this.maxWorkers = config.MAX_WORKERS || os.cpus().length;
    this.scaleUpThreshold = config.SCALE_UP_THRESHOLD || 0.7;
    this.scaleDownThreshold = config.SCALE_DOWN_THRESHOLD || 0.3;
    this.scaleCheckInterval = config.SCALE_CHECK_INTERVAL || 30000; // 30 secondi
    this.cooldownPeriod = config.COOLDOWN_PERIOD || 60000; // 1 minuto
    
    this.currentWorkers = this.minWorkers;
    this.lastScaleTime = 0;
    this.cpuHistory = [];
    this.historyMaxLength = 10;
    
    // Avvia il timer per il controllo periodico
    if (this.enabled && this.scaleCheckInterval > 0) {
      setInterval(() => this.checkScaling(), this.scaleCheckInterval);
    }
  }
  
  // Controlla se è necessario scalare
  async checkScaling() {
    if (!this.enabled) return;
    
    const now = Date.now();
    
    // Verifica se è in corso un cooldown
    if (now - this.lastScaleTime < this.cooldownPeriod) {
      return;
    }
    
    // Ottieni l'utilizzo della CPU
    const cpuUsage = await this.getCPUUsage();
    
    // Aggiorna la storia dell'utilizzo della CPU
    this.cpuHistory.push(cpuUsage);
    if (this.cpuHistory.length > this.historyMaxLength) {
      this.cpuHistory.shift();
    }
    
    // Calcola l'utilizzo medio della CPU
    const avgCpuUsage = this.cpuHistory.reduce((sum, usage) => sum + usage, 0) / this.cpuHistory.length;
    
    // Verifica se è necessario scalare
    if (avgCpuUsage > this.scaleUpThreshold && this.currentWorkers < this.maxWorkers) {
      // Scale up
      const newWorkers = Math.min(this.currentWorkers + 1, this.maxWorkers);
      this.scaleWorkers(newWorkers);
      this.lastScaleTime = now;
    } else if (avgCpuUsage < this.scaleDownThreshold && this.currentWorkers > this.minWorkers) {
      // Scale down
      const newWorkers = Math.max(this.currentWorkers - 1, this.minWorkers);
      this.scaleWorkers(newWorkers);
      this.lastScaleTime = now;
    }
  }
  
  // Scala il numero di worker
  scaleWorkers(newWorkerCount) {
    if (newWorkerCount === this.currentWorkers) return;
    
    console.log(`Auto-scaling: ${this.currentWorkers} -> ${newWorkerCount} workers`);
    
    // Implementazione specifica per il cluster
    if (cluster.isPrimary) {
      const currentWorkers = Object.keys(cluster.workers).length;
      
      if (newWorkerCount > currentWorkers) {
        // Aggiungi worker
        for (let i = currentWorkers; i < newWorkerCount; i++) {
          cluster.fork();
        }
      } else if (newWorkerCount < currentWorkers) {
        // Rimuovi worker
        const workersToRemove = Object.values(cluster.workers).slice(newWorkerCount);
        for (const worker of workersToRemove) {
          worker.disconnect();
        }
      }
    }
    
    this.currentWorkers = newWorkerCount;
  }
  
  // Ottieni l'utilizzo della CPU
  async getCPUUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      const startTime = process.hrtime.bigint();
      
      // Misura l'utilizzo della CPU per 100ms
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const endTime = process.hrtime.bigint();
        
        const elapsedMs = Number(endTime - startTime) / 1000000;
        const cpuUsage = (endUsage.user + endUsage.system) / 1000 / elapsedMs;
        
        resolve(Math.min(cpuUsage, 1));
      }, 100);
    });
  }
  
  // Ottieni le statistiche dell'auto-scaling
  getStats() {
    return {
      enabled: this.enabled,
      currentWorkers: this.currentWorkers,
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      scaleUpThreshold: this.scaleUpThreshold,
      scaleDownThreshold: this.scaleDownThreshold,
      lastScaleTime: this.lastScaleTime,
      cpuHistory: this.cpuHistory
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

// Classe principale del Bundle Engine Scalabile
class ScalableBundleEngine {
  constructor(connection, tokenAddress, options = {}) {
    this.connection = connection;
    this.tokenAddress = new PublicKey(tokenAddress);
    this.pendingTransactions = [];
    this.executedBundles = [];
    this.bundleInProgress = false;
    this.workers = [];
    
    // Opzioni di configurazione
    this.options = {
      walletManager: options.walletManager || null,
      walletName: options.walletName || 'default',
      walletPassword: options.walletPassword || null,
      keypairPath: options.keypairPath || path.join(process.env.HOME, '.config', 'solana', 'id.json'),
      autoScaling: options.autoScaling || SCALING_CONFIG.AUTO_SCALING,
      loadBalancing: options.loadBalancing || SCALING_CONFIG.LOAD_BALANCING,
      sharding: options.sharding || SCALING_CONFIG.SHARDING,
      caching: options.caching || SCALING_CONFIG.CACHING,
      throttling: options.throttling || SCALING_CONFIG.THROTTLING
    };
    
    // Inizializza i componenti di sicurezza
    this.secureWalletManager = this.options.walletManager || new SecureWalletManager();
    this.reentrancyGuard = new ReentrancyGuard();
    this.signatureVerifier = new SignatureVerifier();
    
    // Inizializza i componenti di scalabilità
    this.cacheManager = new CacheManager(this.options.caching);
    this.throttlingManager = new ThrottlingManager(this.options.throttling);
    this.shardManager = new ShardManager(this.options.sharding);
    this.autoScalingManager = new AutoScalingManager(this.options.autoScaling);
    
    // Inizializza l'ottimizzatore di transazioni
    this.transactionOptimizer = new TransactionOptimizer();
    
    // Inizializza il timer per il bundle
    this.bundleTimer = null;
    
    // Inizializza i worker threads per il parallelismo
    this.initializeWorkers();
    
    // Carica il wallet
    this.loadWallet();
    
    console.log(`Bundle Engine Scalabile inizializzato per il token: ${tokenAddress}`);
    console.log(`Dimensione bundle: ${BUNDLE_SIZE}, Timeout: ${BUNDLE_TIMEOUT}ms, Fee: ${FEE_PERCENTAGE}%`);
    console.log(`Worker threads: ${this.workers.length}`);
  }
  
  // Inizializza i worker threads per il parallelismo
  initializeWorkers() {
    if (isMainThread) {
      const workerCount = this.options.autoScaling.ENABLED ? 
        this.options.autoScaling.MIN_WORKERS : 
        MAX_WORKER_THREADS;
      
      for (let i = 0; i < workerCount; i++) {
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
  
  // Carica il wallet in modo sicuro
  loadWallet() {
    try {
      if (this.options.walletName && this.options.walletPassword) {
        // Carica il wallet utilizzando il SecureWalletManager
        this.wallet = this.secureWalletManager.loadWallet(
          this.options.walletName,
          this.options.walletPassword
        );
        console.log(`Wallet caricato in modo sicuro: ${this.wallet.publicKey.toString()}`);
      } else {
        // Fallback al caricamento tradizionale
        console.warn('Attenzione: utilizzo del caricamento tradizionale del wallet. Si consiglia di utilizzare SecureWalletManager.');
        const walletData = JSON.parse(fs.readFileSync(this.options.keypairPath, 'utf8'));
        this.wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
        console.log(`Wallet caricato: ${this.wallet.publicKey.toString()}`);
      }
    } catch (error) {
      console.error('Errore durante il caricamento del wallet:', error);
      throw new Error(`Impossibile caricare il wallet: ${error.message}`);
    }
  }
  
  // Aggiunge una transazione al bundle con protezione contro reentrancy
  async addTransaction(fromKeypair, toWallet, amount, ip = '127.0.0.1') {
    // Verifica il throttling
    if (this.options.throttling.ENABLED && !this.throttlingManager.isAllowed(ip)) {
      throw new Error('Limite di richieste superato. Riprova più tardi.');
    }
    
    // Registra la richiesta per il throttling
    if (this.options.throttling.ENABLED) {
      this.throttlingManager.recordRequest(ip);
    }
    
    // Esegui con protezione contro reentrancy
    return this.reentrancyGuard.executeWithGuard(
      `add_transaction_${fromKeypair.publicKey.toString()}_${toWallet.toString()}`,
      async () => {
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
        
        // Aggiungi la transazione allo shard appropriato
        const shardIndex = this.options.sharding.ENABLED ? 
          this.shardManager.assignToShard(transaction) : 
          0;
        
        // Aggiungi la transazione alla lista delle transazioni in attesa
        this.pendingTransactions.push(transaction);
        
        // Imposta un timer per l'esecuzione del bundle se non è già impostato
        if (!this.bundleTimer && this.pendingTransactions.length > 0) {
          const timeout = this.calculateDynamicTimeout();
          
          this.bundleTimer = setTimeout(() => {
            this.bundleTimer = null;
            
            if (this.pendingTransactions.length > 0 && !this.bundleInProgress) {
              this.executeBundleTransactions();
            }
          }, timeout);
          
          console.log(`Timer impostato per l'esecuzione del bundle tra ${timeout}ms`);
        }
        
        // Verifica se è conveniente eseguire il bundle prima del timeout
        if (this.shouldExecuteEarly() && !this.bundleInProgress) {
          // Cancella il timer esistente
          if (this.bundleTimer) {
            clearTimeout(this.bundleTimer);
            this.bundleTimer = null;
          }
          
          // Esegui il bundle immediatamente
          this.executeBundleTransactions();
        }
        
        return {
          transactionId,
          priority,
          shardIndex,
          pendingTransactions: this.pendingTransactions.length,
          estimatedExecutionTime: this.bundleTimer ? 
            Math.max(0, BUNDLE_TIMEOUT - (Date.now() - this.pendingTransactions[0].timestamp)) : 
            0
        };
      }
    );
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
  
  // Esegue le transazioni in bundle con parallelismo e protezione contro reentrancy
  async executeBundleTransactions() {
    return this.reentrancyGuard.executeWithGuard(
      'execute_bundle',
      async () => {
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
          throw error;
        } finally {
          this.bundleInProgress = false;
        }
      }
    );
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
  
  // Crea e invia una transazione con verifica della firma
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
      
      // Verifica la firma
      const isValid = this.signatureVerifier.verifyTransaction(tx);
      if (!isValid) {
        console.warn(`Avviso: La verifica della firma per la transazione ${transaction.id} è fallita`);
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
      nextBundleTime: this.bundleTimer ? Date.now() + (BUNDLE_TIMEOUT - (Date.now() - this.pendingTransactions[0]?.timestamp || 0)) : null,
      cacheStats: this.cacheManager.getStats(),
      throttlingStats: this.throttlingManager.getStats(),
      shardingStats: this.shardManager.getStats(),
      autoScalingStats: this.autoScalingManager.getStats()
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

// Esporta le classi
module.exports = {
  ScalableBundleEngine,
  SafeMath,
  TransactionOptimizer,
  CacheManager,
  ThrottlingManager,
  ShardManager,
  AutoScalingManager
};
