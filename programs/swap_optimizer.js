// Swap Optimizer Program per Solana
// Questo programma ottimizza gli swap per massimizzare i rendimenti

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configurazione
const SLIPPAGE_TOLERANCE = 0.5; // Tolleranza di slippage in percentuale
const GAS_PRICE_THRESHOLD = 10; // Soglia di prezzo del gas in Lamports
const REWARD_OPTIMIZATION_ENABLED = true; // Abilita l'ottimizzazione dei reward

// Configurazione del rate limiting
const RATE_LIMIT_CONFIG = {
  // Limiti per wallet
  WALLET: {
    MAX_REQUESTS_PER_MINUTE: 10,
    MAX_REQUESTS_PER_HOUR: 100,
    MAX_SWAP_AMOUNT_PER_DAY: 1000000, // Importo massimo di token per wallet al giorno
    COOLDOWN_AFTER_LARGE_SWAP: 60000, // Tempo di attesa in ms dopo uno swap di grandi dimensioni (1 minuto)
    LARGE_SWAP_THRESHOLD: 10000, // Soglia per considerare uno swap come "grande"
  },
  // Limiti globali
  GLOBAL: {
    MAX_CONCURRENT_REQUESTS: 20,
    MAX_REQUESTS_PER_MINUTE: 100,
    BACKOFF_BASE_MS: 1000, // Tempo base per il backoff esponenziale in ms
    BACKOFF_MAX_MS: 60000, // Tempo massimo per il backoff esponenziale in ms (1 minuto)
    CIRCUIT_BREAKER_THRESHOLD: 50, // Numero di errori consecutivi per attivare il circuit breaker
    CIRCUIT_BREAKER_RESET_TIME: 300000, // Tempo di reset del circuit breaker in ms (5 minuti)
  }
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

// Classe per gestire il rate limiting
class RateLimiter {
  constructor() {
    this.walletRequests = new Map(); // Mappa per tracciare le richieste per wallet
    this.globalRequests = {
      lastMinute: [],
      concurrentRequests: 0,
      errorCount: 0,
      circuitBreakerActive: false,
      circuitBreakerTimeout: null
    };
    this.swapHistory = new Map(); // Mappa per tracciare la storia degli swap per wallet
  }

  // Registra una richiesta per un wallet
  registerWalletRequest(walletAddress) {
    const now = Date.now();
    const walletKey = walletAddress.toString();
    
    // Inizializza i dati del wallet se non esistono
    if (!this.walletRequests.has(walletKey)) {
      this.walletRequests.set(walletKey, {
        requests: [],
        lastLargeSwapTime: 0
      });
    }
    
    const walletData = this.walletRequests.get(walletKey);
    
    // Aggiungi la richiesta corrente
    walletData.requests.push(now);
    
    // Rimuovi le richieste più vecchie di un'ora
    walletData.requests = walletData.requests.filter(time => now - time < 3600000);
    
    // Calcola le richieste nell'ultimo minuto
    const requestsLastMinute = walletData.requests.filter(time => now - time < 60000).length;
    
    // Calcola le richieste nell'ultima ora
    const requestsLastHour = walletData.requests.length;
    
    // Verifica se il wallet è in cooldown dopo uno swap di grandi dimensioni
    const isInCooldown = now - walletData.lastLargeSwapTime < RATE_LIMIT_CONFIG.WALLET.COOLDOWN_AFTER_LARGE_SWAP;
    
    return {
      isRateLimited: 
        requestsLastMinute > RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_MINUTE ||
        requestsLastHour > RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_HOUR ||
        isInCooldown,
      requestsLastMinute,
      requestsLastHour,
      isInCooldown,
      cooldownRemaining: isInCooldown ? 
        RATE_LIMIT_CONFIG.WALLET.COOLDOWN_AFTER_LARGE_SWAP - (now - walletData.lastLargeSwapTime) : 0
    };
  }

  // Registra uno swap per un wallet
  registerSwap(walletAddress, amount) {
    const now = Date.now();
    const walletKey = walletAddress.toString();
    
    // Inizializza la storia degli swap per il wallet se non esiste
    if (!this.swapHistory.has(walletKey)) {
      this.swapHistory.set(walletKey, []);
    }
    
    const swapHistory = this.swapHistory.get(walletKey);
    
    // Aggiungi lo swap corrente
    swapHistory.push({
      amount,
      timestamp: now
    });
    
    // Rimuovi gli swap più vecchi di un giorno
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const updatedHistory = swapHistory.filter(swap => swap.timestamp >= oneDayAgo);
    this.swapHistory.set(walletKey, updatedHistory);
    
    // Calcola l'importo totale degli swap nelle ultime 24 ore
    const totalSwapAmount = updatedHistory.reduce((sum, swap) => sum + swap.amount, 0);
    
    // Verifica se questo è uno swap di grandi dimensioni
    if (amount >= RATE_LIMIT_CONFIG.WALLET.LARGE_SWAP_THRESHOLD) {
      // Aggiorna il timestamp dell'ultimo swap di grandi dimensioni
      const walletData = this.walletRequests.get(walletKey) || { requests: [], lastLargeSwapTime: 0 };
      walletData.lastLargeSwapTime = now;
      this.walletRequests.set(walletKey, walletData);
    }
    
    return {
      isLimited: totalSwapAmount > RATE_LIMIT_CONFIG.WALLET.MAX_SWAP_AMOUNT_PER_DAY,
      totalSwapAmount,
      dailyLimit: RATE_LIMIT_CONFIG.WALLET.MAX_SWAP_AMOUNT_PER_DAY,
      remaining: Math.max(0, RATE_LIMIT_CONFIG.WALLET.MAX_SWAP_AMOUNT_PER_DAY - totalSwapAmount)
    };
  }

  // Registra una richiesta globale
  registerGlobalRequest() {
    const now = Date.now();
    
    // Incrementa il contatore di richieste concorrenti
    this.globalRequests.concurrentRequests++;
    
    // Aggiungi la richiesta corrente
    this.globalRequests.lastMinute.push(now);
    
    // Rimuovi le richieste più vecchie di un minuto
    this.globalRequests.lastMinute = this.globalRequests.lastMinute.filter(time => now - time < 60000);
    
    // Calcola le richieste nell'ultimo minuto
    const requestsLastMinute = this.globalRequests.lastMinute.length;
    
    // Verifica se il circuit breaker è attivo
    const isCircuitBreakerActive = this.globalRequests.circuitBreakerActive;
    
    return {
      isRateLimited: 
        requestsLastMinute > RATE_LIMIT_CONFIG.GLOBAL.MAX_REQUESTS_PER_MINUTE ||
        this.globalRequests.concurrentRequests > RATE_LIMIT_CONFIG.GLOBAL.MAX_CONCURRENT_REQUESTS ||
        isCircuitBreakerActive,
      requestsLastMinute,
      concurrentRequests: this.globalRequests.concurrentRequests,
      isCircuitBreakerActive
    };
  }

  // Completa una richiesta globale
  completeGlobalRequest(success = true) {
    // Decrementa il contatore di richieste concorrenti
    this.globalRequests.concurrentRequests = Math.max(0, this.globalRequests.concurrentRequests - 1);
    
    // Aggiorna il contatore di errori
    if (!success) {
      this.globalRequests.errorCount++;
      
      // Verifica se attivare il circuit breaker
      if (this.globalRequests.errorCount >= RATE_LIMIT_CONFIG.GLOBAL.CIRCUIT_BREAKER_THRESHOLD && !this.globalRequests.circuitBreakerActive) {
        this.activateCircuitBreaker();
      }
    } else {
      // Resetta il contatore di errori se la richiesta ha avuto successo
      this.globalRequests.errorCount = 0;
    }
  }

  // Attiva il circuit breaker
  activateCircuitBreaker() {
    console.warn('Circuit breaker attivato a causa di troppi errori consecutivi');
    
    this.globalRequests.circuitBreakerActive = true;
    
    // Imposta un timeout per disattivare il circuit breaker
    if (this.globalRequests.circuitBreakerTimeout) {
      clearTimeout(this.globalRequests.circuitBreakerTimeout);
    }
    
    this.globalRequests.circuitBreakerTimeout = setTimeout(() => {
      console.log('Circuit breaker disattivato');
      this.globalRequests.circuitBreakerActive = false;
      this.globalRequests.errorCount = 0;
    }, RATE_LIMIT_CONFIG.GLOBAL.CIRCUIT_BREAKER_RESET_TIME);
  }

  // Calcola il tempo di backoff esponenziale
  calculateBackoff(attempts) {
    // Implementa il backoff esponenziale con jitter
    const baseTime = RATE_LIMIT_CONFIG.GLOBAL.BACKOFF_BASE_MS;
    const maxTime = RATE_LIMIT_CONFIG.GLOBAL.BACKOFF_MAX_MS;
    
    // Formula: min(maxTime, baseTime * 2^attempts + random jitter)
    const exponentialPart = baseTime * Math.pow(2, Math.min(attempts, 10)); // Limita l'esponente per evitare overflow
    const jitter = Math.random() * baseTime; // Jitter casuale
    
    return Math.min(maxTime, exponentialPart + jitter);
  }

  // Ottieni statistiche sul rate limiting
  getStats() {
    const now = Date.now();
    
    // Calcola statistiche globali
    const globalStats = {
      requestsLastMinute: this.globalRequests.lastMinute.length,
      concurrentRequests: this.globalRequests.concurrentRequests,
      errorCount: this.globalRequests.errorCount,
      circuitBreakerActive: this.globalRequests.circuitBreakerActive,
      circuitBreakerResetTime: this.globalRequests.circuitBreakerActive ? 
        (this.globalRequests.circuitBreakerTimeout._idleStart + this.globalRequests.circuitBreakerTimeout._idleTimeout - now) : 0
    };
    
    // Calcola statistiche per wallet
    const walletStats = {};
    for (const [walletKey, walletData] of this.walletRequests.entries()) {
      const requestsLastMinute = walletData.requests.filter(time => now - time < 60000).length;
      const requestsLastHour = walletData.requests.length;
      const isInCooldown = now - walletData.lastLargeSwapTime < RATE_LIMIT_CONFIG.WALLET.COOLDOWN_AFTER_LARGE_SWAP;
      
      walletStats[walletKey] = {
        requestsLastMinute,
        requestsLastHour,
        isInCooldown,
        cooldownRemaining: isInCooldown ? 
          RATE_LIMIT_CONFIG.WALLET.COOLDOWN_AFTER_LARGE_SWAP - (now - walletData.lastLargeSwapTime) : 0
      };
    }
    
    // Calcola statistiche per gli swap
    const swapStats = {};
    for (const [walletKey, swapHistory] of this.swapHistory.entries()) {
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const recentSwaps = swapHistory.filter(swap => swap.timestamp >= oneDayAgo);
      const totalSwapAmount = recentSwaps.reduce((sum, swap) => sum + swap.amount, 0);
      
      swapStats[walletKey] = {
        swapCount: recentSwaps.length,
        totalSwapAmount,
        isLimited: totalSwapAmount > RATE_LIMIT_CONFIG.WALLET.MAX_SWAP_AMOUNT_PER_DAY,
        remaining: Math.max(0, RATE_LIMIT_CONFIG.WALLET.MAX_SWAP_AMOUNT_PER_DAY - totalSwapAmount)
      };
    }
    
    return {
      global: globalStats,
      wallets: walletStats,
      swaps: swapStats,
      config: RATE_LIMIT_CONFIG
    };
  }
}

class SwapOptimizer {
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
    this.routes = [];
    this.rewardRates = new Map();
    this.math = safeArithmetic(); // Inizializza le funzioni aritmetiche sicure
    this.rateLimiter = new RateLimiter(); // Inizializza il rate limiter
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

  // Aggiunge una rotta di swap
  addSwapRoute(sourceToken, targetToken, dex, fee) {
    try {
      // Validazione degli input
      if (!sourceToken || !targetToken) {
        throw new Error('sourceToken e targetToken non possono essere null o undefined');
      }
      
      let sourceTokenPubkey, targetTokenPubkey;
      try {
        // Verifica che i token siano PublicKey valide
        sourceTokenPubkey = sourceToken instanceof PublicKey ? sourceToken : new PublicKey(sourceToken);
        targetTokenPubkey = targetToken instanceof PublicKey ? targetToken : new PublicKey(targetToken);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (!dex || typeof dex !== 'string') {
        throw new Error('dex deve essere una stringa valida');
      }
      
      if (typeof fee !== 'number' || isNaN(fee) || fee < 0) {
        throw new Error('fee deve essere un numero non negativo');
      }
      
      console.log(`Aggiunta rotta di swap: ${sourceTokenPubkey} -> ${targetTokenPubkey} su ${dex} (fee: ${fee}%)`);
      
      // Verifica se la rotta esiste già
      const existingRouteIndex = this.routes.findIndex(route => 
        route.sourceToken.equals(sourceTokenPubkey) && 
        route.targetToken.equals(targetTokenPubkey) && 
        route.dex === dex
      );
      
      if (existingRouteIndex !== -1) {
        // Aggiorna la rotta esistente
        this.routes[existingRouteIndex].fee = fee;
        console.log(`Rotta esistente aggiornata con nuova fee: ${fee}%`);
      } else {
        // Aggiungi una nuova rotta
        this.routes.push({
          sourceToken: sourceTokenPubkey,
          targetToken: targetTokenPubkey,
          dex,
          fee,
          active: true,
          addedAt: new Date().toISOString()
        });
      }
      
      return true;
    } catch (error) {
      this.logError('addSwapRoute', error, { 
        sourceToken: sourceToken?.toString(), 
        targetToken: targetToken?.toString(), 
        dex, 
        fee 
      });
      throw error;
    }
  }
  
  // Imposta il tasso di reward per un token
  setRewardRate(tokenAddress, rate) {
    try {
      // Validazione degli input
      if (!tokenAddress) {
        throw new Error('tokenAddress non può essere null o undefined');
      }
      
      let tokenPubkey;
      try {
        // Verifica che tokenAddress sia una PublicKey valida
        tokenPubkey = tokenAddress instanceof PublicKey ? tokenAddress : new PublicKey(tokenAddress);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (typeof rate !== 'number' || isNaN(rate) || rate < 0) {
        throw new Error('rate deve essere un numero non negativo');
      }
      
      this.rewardRates.set(tokenPubkey.toString(), rate);
      console.log(`Tasso di reward impostato per ${tokenPubkey}: ${rate}%`);
      
      return true;
    } catch (error) {
      this.logError('setRewardRate', error, { 
        tokenAddress: tokenAddress?.toString(), 
        rate 
      });
      throw error;
    }
  }
  
  // Trova la rotta migliore per uno swap
  findBestRoute(sourceToken, targetToken, amount) {
    try {
      // Validazione degli input
      if (!sourceToken || !targetToken) {
        throw new Error('sourceToken e targetToken non possono essere null o undefined');
      }
      
      let sourceTokenPubkey, targetTokenPubkey;
      try {
        // Verifica che i token siano PublicKey valide
        sourceTokenPubkey = sourceToken instanceof PublicKey ? sourceToken : new PublicKey(sourceToken);
        targetTokenPubkey = targetToken instanceof PublicKey ? targetToken : new PublicKey(targetToken);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        throw new Error('amount deve essere un numero positivo');
      }
      
      console.log(`Ricerca della rotta migliore per swap: ${sourceTokenPubkey} -> ${targetTokenPubkey}, ${amount} tokens`);
      
      // Filtra le rotte disponibili
      const availableRoutes = this.routes.filter(route => 
        route.active && 
        route.sourceToken.equals(sourceTokenPubkey) && 
        route.targetToken.equals(targetTokenPubkey)
      );
      
      if (availableRoutes.length === 0) {
        console.log('Nessuna rotta disponibile per questo swap');
        return null;
      }
      
      // Calcola il costo effettivo per ogni rotta
      const routesWithCost = availableRoutes.map(route => {
        // Calcola la fee in modo sicuro
        const fee = this.math.multiply(amount, this.math.divide(route.fee, 100));
        
        // Calcola il reward se abilitato
        let reward = 0;
        if (REWARD_OPTIMIZATION_ENABLED) {
          const rewardRate = this.rewardRates.get(targetTokenPubkey.toString()) || 0;
          reward = this.math.multiply(amount, this.math.divide(rewardRate, 100));
        }
        
        // Calcola il costo effettivo (fee - reward)
        const effectiveCost = this.math.clamp(fee - reward, 0, Number.MAX_SAFE_INTEGER);
        
        return {
          ...route,
          fee,
          reward,
          effectiveCost
        };
      });
      
      // Ordina le rotte per costo effettivo (dal più basso al più alto)
      routesWithCost.sort((a, b) => a.effectiveCost - b.effectiveCost);
      
      // Restituisci la rotta migliore
      const bestRoute = routesWithCost[0];
      console.log(`Rotta migliore trovata: ${bestRoute.dex} (costo effettivo: ${bestRoute.effectiveCost})`);
      
      return bestRoute;
    } catch (error) {
      this.logError('findBestRoute', error, { 
        sourceToken: sourceToken?.toString(), 
        targetToken: targetToken?.toString(), 
        amount 
      });
      return null;
    }
  }
  
  // Esegue uno swap ottimizzato
  async executeOptimizedSwap(sourceToken, targetToken, amount, wallet) {
    let globalRequestRegistered = false;
    
    try {
      // Validazione degli input
      if (!sourceToken || !targetToken) {
        throw new Error('sourceToken e targetToken non possono essere null o undefined');
      }
      
      let sourceTokenPubkey, targetTokenPubkey;
      try {
        // Verifica che i token siano PublicKey valide
        sourceTokenPubkey = sourceToken instanceof PublicKey ? sourceToken : new PublicKey(sourceToken);
        targetTokenPubkey = targetToken instanceof PublicKey ? targetToken : new PublicKey(targetToken);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        throw new Error('amount deve essere un numero positivo');
      }
      
      if (!wallet) {
        throw new Error('wallet non può essere null o undefined');
      }
      
      let walletPubkey;
      try {
        // Verifica che wallet sia una PublicKey valida
        walletPubkey = wallet instanceof PublicKey ? wallet : new PublicKey(wallet);
      } catch (error) {
        throw new Error(`Indirizzo wallet non valido: ${error.message}`);
      }
      
      console.log(`Esecuzione swap ottimizzato: ${sourceTokenPubkey} -> ${targetTokenPubkey}, ${amount} tokens`);
      
      // Verifica il rate limiting per il wallet
      const walletRateLimit = this.rateLimiter.registerWalletRequest(walletPubkey);
      
      if (walletRateLimit.isRateLimited) {
        let reason = '';
        if (walletRateLimit.requestsLastMinute > RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_MINUTE) {
          reason = `Troppe richieste nell'ultimo minuto (${walletRateLimit.requestsLastMinute}/${RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_MINUTE})`;
        } else if (walletRateLimit.requestsLastHour > RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_HOUR) {
          reason = `Troppe richieste nell'ultima ora (${walletRateLimit.requestsLastHour}/${RATE_LIMIT_CONFIG.WALLET.MAX_REQUESTS_PER_HOUR})`;
        } else if (walletRateLimit.isInCooldown) {
          reason = `In cooldown dopo uno swap di grandi dimensioni (${Math.ceil(walletRateLimit.cooldownRemaining / 1000)} secondi rimanenti)`;
        }
        
        throw new Error(`Rate limit superato per il wallet. ${reason}`);
      }
      
      // Verifica il limite di swap giornaliero
      const swapLimit = this.rateLimiter.registerSwap(walletPubkey, amount);
      
      if (swapLimit.isLimited) {
        throw new Error(`Limite giornaliero di swap superato (${swapLimit.totalSwapAmount}/${swapLimit.dailyLimit})`);
      }
      
      // Verifica il rate limiting globale
      const globalRateLimit = this.rateLimiter.registerGlobalRequest();
      globalRequestRegistered = true;
      
      if (globalRateLimit.isRateLimited) {
        let reason = '';
        if (globalRateLimit.requestsLastMinute > RATE_LIMIT_CONFIG.GLOBAL.MAX_REQUESTS_PER_MINUTE) {
          reason = `Troppe richieste globali nell'ultimo minuto (${globalRateLimit.requestsLastMinute}/${RATE_LIMIT_CONFIG.GLOBAL.MAX_REQUESTS_PER_MINUTE})`;
        } else if (globalRateLimit.concurrentRequests > RATE_LIMIT_CONFIG.GLOBAL.MAX_CONCURRENT_REQUESTS) {
          reason = `Troppe richieste concorrenti (${globalRateLimit.concurrentRequests}/${RATE_LIMIT_CONFIG.GLOBAL.MAX_CONCURRENT_REQUESTS})`;
        } else if (globalRateLimit.isCircuitBreakerActive) {
          reason = 'Circuit breaker attivo a causa di troppi errori consecutivi';
        }
        
        throw new Error(`Rate limit globale superato. ${reason}`);
      }
      
      // Trova la rotta migliore
      const bestRoute = this.findBestRoute(sourceTokenPubkey, targetTokenPubkey, amount);
      
      if (!bestRoute) {
        throw new Error('Nessuna rotta disponibile per questo swap');
      }
      
      // Verifica il prezzo del gas
      const gasPrice = await this.connection.getRecentBlockhash().then(res => res.feeCalculator.lamportsPerSignature);
      console.log(`Prezzo attuale del gas: ${gasPrice} Lamports`);
      
      if (gasPrice > GAS_PRICE_THRESHOLD) {
        console.log(`Prezzo del gas troppo alto (${gasPrice} > ${GAS_PRICE_THRESHOLD}), attesa di condizioni migliori`);
        return {
          success: false,
          error: `Prezzo del gas troppo alto (${gasPrice} > ${GAS_PRICE_THRESHOLD})`,
          shouldRetry: true,
          retryAfter: 30000 // Riprova dopo 30 secondi
        };
      }
      
      // In un'implementazione reale, qui eseguiremmo lo swap effettivo
      // utilizzando le API del DEX specifico
      
      // Simuliamo il risultato dello swap
      const outputAmount = this.math.clamp(
        this.math.multiply(amount, (1 - this.math.divide(bestRoute.fee, 100))),
        0,
        Number.MAX_SAFE_INTEGER
      );
      
      const result = {
        success: true,
        sourceToken: sourceTokenPubkey.toString(),
        targetToken: targetTokenPubkey.toString(),
        inputAmount: amount,
        outputAmount,
        dex: bestRoute.dex,
        fee: bestRoute.fee,
        reward: bestRoute.reward,
        effectiveCost: bestRoute.effectiveCost,
        gasPrice,
        timestamp: new Date().toISOString(),
        wallet: walletPubkey.toString()
      };
      
      console.log(`Swap eseguito con successo! Output: ${result.outputAmount} tokens`);
      
      // Completa la richiesta globale con successo
      if (globalRequestRegistered) {
        this.rateLimiter.completeGlobalRequest(true);
      }
      
      return result;
    } catch (error) {
      // Completa la richiesta globale con errore
      if (globalRequestRegistered) {
        this.rateLimiter.completeGlobalRequest(false);
      }
      
      this.logError('executeOptimizedSwap', error, { 
        sourceToken: sourceToken?.toString(), 
        targetToken: targetToken?.toString(), 
        amount,
        wallet: wallet?.toString()
      });
      
      // Determina se la richiesta dovrebbe essere riprovata
      const shouldRetry = error.message.includes('Rate limit') || 
                          error.message.includes('Prezzo del gas troppo alto');
      
      // Calcola il tempo di backoff se necessario
      const retryAfter = shouldRetry ? 
        this.rateLimiter.calculateBackoff(this.errorLog.filter(e => 
          e.operation === 'executeOptimizedSwap' && 
          e.metadata.wallet === wallet?.toString()
        ).length) : 0;
      
      return {
        success: false,
        error: error.message,
        shouldRetry,
        retryAfter
      };
    }
  }
  
  // Ottimizza gli swap soggetti a reward tax
  optimizeRewardTax(tokenAddress, amount, holdDuration) {
    try {
      // Validazione degli input
      if (!tokenAddress) {
        throw new Error('tokenAddress non può essere null o undefined');
      }
      
      let tokenPubkey;
      try {
        // Verifica che tokenAddress sia una PublicKey valida
        tokenPubkey = tokenAddress instanceof PublicKey ? tokenAddress : new PublicKey(tokenAddress);
      } catch (error) {
        throw new Error(`Indirizzo token non valido: ${error.message}`);
      }
      
      if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
        throw new Error('amount deve essere un numero positivo');
      }
      
      if (typeof holdDuration !== 'number' || isNaN(holdDuration) || holdDuration < 0) {
        throw new Error('holdDuration deve essere un numero non negativo');
      }
      
      console.log(`Ottimizzazione reward tax per ${tokenPubkey}, ${amount} tokens, durata: ${holdDuration} giorni`);
      
      // Ottieni il tasso di reward
      const rewardRate = this.rewardRates.get(tokenPubkey.toString()) || 0;
      
      if (rewardRate === 0) {
        console.log('Nessun reward configurato per questo token');
        return { 
          optimal: false, 
          holdRecommended: false,
          tokenAddress: tokenPubkey.toString(),
          amount,
          holdDuration,
          rewardRate: 0
        };
      }
      
      // Calcola il reward totale per la durata specificata in modo sicuro
      const dailyReward = this.math.multiply(
        amount, 
        this.math.divide(
          this.math.divide(rewardRate, 100), 
          365
        )
      );
      
      const totalReward = this.math.multiply(dailyReward, holdDuration);
      
      // Calcola la percentuale di reward sul totale
      const rewardPercentage = this.math.multiply(
        this.math.divide(totalReward, amount), 
        100
      );
      
      console.log(`Reward stimato: ${totalReward} tokens (${rewardPercentage.toFixed(2)}% dell'importo iniziale)`);
      
      // Determina se è conveniente mantenere i token per la durata specificata
      const holdRecommended = rewardPercentage >= 1; // Soglia dell'1%
      
      return {
        optimal: true,
        holdRecommended,
        estimatedReward: totalReward,
        rewardPercentage,
        dailyReward,
        holdDuration,
        tokenAddress: tokenPubkey.toString(),
        amount,
        rewardRate
      };
    } catch (error) {
      this.logError('optimizeRewardTax', error, { 
        tokenAddress: tokenAddress?.toString(), 
        amount, 
        holdDuration 
      });
      
      return {
        optimal: false,
        error: error.message,
        tokenAddress: tokenAddress?.toString(),
        amount,
        holdDuration
      };
    }
  }
  
  // Ottieni statistiche sul rate limiting
  getRateLimitStats() {
    return this.rateLimiter.getStats();
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

// Funzione per deployare lo Swap Optimizer
async function deploySwapOptimizer(tokenAddress) {
  console.log('Iniziando il deployment dello Swap Optimizer...');
  
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
    
    // Crea un'istanza dello Swap Optimizer
    const swapOptimizer = new SwapOptimizer(connection, tokenPubkey);
    
    // Configura alcune rotte di esempio
    const usdcPublicKey = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC su Solana
    
    swapOptimizer.addSwapRoute(tokenPubkey, usdcPublicKey, 'Raydium', 0.3);
    swapOptimizer.addSwapRoute(tokenPubkey, usdcPublicKey, 'Orca', 0.25);
    swapOptimizer.addSwapRoute(tokenPubkey, usdcPublicKey, 'Jupiter', 0.2);
    
    // Imposta alcuni tassi di reward di esempio
    swapOptimizer.setRewardRate(tokenPubkey, 5); // 5% di reward annuale
    
    // Salva le informazioni dello Swap Optimizer
    const swapOptimizerInfo = {
      tokenAddress: tokenPubkey.toString(),
      slippageTolerance: SLIPPAGE_TOLERANCE,
      gasPriceThreshold: GAS_PRICE_THRESHOLD,
      rewardOptimizationEnabled: REWARD_OPTIMIZATION_ENABLED,
      rateLimitConfig: RATE_LIMIT_CONFIG,
      configuredRoutes: swapOptimizer.routes.map(route => ({
        sourceToken: route.sourceToken.toString(),
        targetToken: route.targetToken.toString(),
        dex: route.dex,
        fee: route.fee
      })),
      rewardRates: Array.from(swapOptimizer.rewardRates.entries()).map(([token, rate]) => ({
        token,
        rate
      })),
      deploymentTimestamp: new Date().toISOString(),
      deployer: walletKeypair.publicKey.toString()
    };
    
    // Salva le informazioni in un file JSON
    const infoPath = path.join(__dirname, '../deployment-info/swap_optimizer_info.json');
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify(swapOptimizerInfo, null, 2));
    
    console.log(`Swap Optimizer deployato con successo per il token: ${tokenPubkey.toString()}`);
    console.log(`Informazioni salvate in: ${infoPath}`);
    
    return swapOptimizerInfo;
  } catch (error) {
    console.error('Errore durante il deployment dello Swap Optimizer:', error);
    throw error;
  }
}

// Esporta la classe e la funzione di deployment
module.exports = {
  SwapOptimizer,
  deploySwapOptimizer,
  RATE_LIMIT_CONFIG
};

// Se eseguito direttamente, esegui il deployment
if (require.main === module) {
  // Prendi l'indirizzo del token come argomento
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.error('Errore: Indirizzo del token non specificato');
    console.log('Uso: node swap_optimizer.js <indirizzo_token>');
    process.exit(1);
  }
  
  deploySwapOptimizer(tokenAddress)
    .then(info => {
      console.log('Swap Optimizer deployato con successo!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Errore durante il deployment dello Swap Optimizer:', error);
      process.exit(1);
    });
}
