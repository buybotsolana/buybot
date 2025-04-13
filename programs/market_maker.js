// Market Maker Program per Solana
// Questo programma fornisce liquidità e stabilizza il prezzo del token

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configurazione
const PRICE_STABILITY_THRESHOLD = 3; // Percentuale massima di variazione del prezzo
const LIQUIDITY_DEPTH_TARGET = 5; // Profondità di liquidità target in percentuale della market cap
const SPREAD_TARGET = 0.5; // Spread target in percentuale
const REBALANCE_INTERVAL = 3600000; // Intervallo di ribilanciamento in ms (1 ora)
const MAX_PRICE_CHANGE_PER_REBALANCE = 2; // Massima variazione percentuale del prezzo per ribilanciamento
const PRICE_IMPACT_THRESHOLD = 5; // Soglia di impatto sul prezzo per rilevare manipolazioni
const MIN_LIQUIDITY_THRESHOLD = 1000; // Soglia minima di liquidità (in USDC) per prevenire manipolazioni
const CIRCUIT_BREAKER_THRESHOLD = 10; // Soglia percentuale per attivare il circuit breaker
const CIRCUIT_BREAKER_COOLDOWN = 3600000; // Periodo di cooldown del circuit breaker in ms (1 ora)
const VOLUME_ANOMALY_THRESHOLD = 3; // Moltiplicatore del volume medio per rilevare anomalie
const PRICE_ANOMALY_WINDOW = 10; // Numero di campioni di prezzo per rilevare anomalie
const MAX_ORDER_SIZE_PERCENTAGE = 10; // Dimensione massima dell'ordine come percentuale della liquidità totale

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

  // Calcola la variazione percentuale in modo sicuro
  const safePercentageChange = (oldValue, newValue) => {
    if (oldValue === 0) return 0;
    return safeDivide(Math.abs(newValue - oldValue), oldValue) * 100;
  };

  return {
    add: safeAdd,
    multiply: safeMultiply,
    divide: safeDivide,
    clamp,
    percentageChange: safePercentageChange
  };
}

class MarketMaker {
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
    this.orderBook = {
      bids: [], // Ordini di acquisto
      asks: []  // Ordini di vendita
    };
    this.currentPrice = 0;
    this.priceHistory = [];
    this.volumeHistory = [];
    this.rebalanceInterval = null;
    this.liquidityPool = {
      token: 0,
      usdc: 0
    };
    this.circuitBreakerActive = false;
    this.circuitBreakerTimeout = null;
    this.lastTradeTimestamps = []; // Per rilevare trading ad alta frequenza
    this.math = safeArithmetic(); // Inizializza le funzioni aritmetiche sicure
    this.anomalyDetectionEnabled = true;
    this.manipulationAttempts = 0;
  }

  // Inizializza il market maker con un pool di liquidità
  async initialize(tokenAmount, usdcAmount, initialPrice) {
    // Validazione degli input
    if (tokenAmount <= 0 || usdcAmount <= 0 || initialPrice <= 0) {
      throw new Error('tokenAmount, usdcAmount e initialPrice devono essere positivi');
    }
    
    console.log(`Inizializzazione Market Maker con ${tokenAmount} token e ${usdcAmount} USDC`);
    
    this.liquidityPool.token = tokenAmount;
    this.liquidityPool.usdc = usdcAmount;
    this.currentPrice = initialPrice;
    
    // Registra il prezzo iniziale
    this.priceHistory.push({
      price: initialPrice,
      timestamp: new Date().toISOString()
    });
    
    // Inizializza la storia del volume
    this.volumeHistory.push({
      volume: 0,
      timestamp: new Date().toISOString()
    });
    
    // Crea gli ordini iniziali
    await this.generateOrders();
    
    // Avvia il ribilanciamento periodico
    this.startRebalancing();
    
    console.log(`Market Maker inizializzato con successo. Prezzo iniziale: $${initialPrice}`);
  }
  
  // Genera ordini di acquisto e vendita
  async generateOrders() {
    console.log('Generazione degli ordini di acquisto e vendita...');
    
    // Svuota l'order book
    this.orderBook.bids = [];
    this.orderBook.asks = [];
    
    // Calcola lo spread
    const halfSpread = this.math.clamp(SPREAD_TARGET / 2, 0.1, 5);
    const bidPrice = this.math.multiply(this.currentPrice, (1 - halfSpread / 100));
    const askPrice = this.math.multiply(this.currentPrice, (1 + halfSpread / 100));
    
    // Calcola la profondità di liquidità
    const marketCap = this.math.multiply(this.liquidityPool.token, this.currentPrice);
    const liquidityDepth = this.math.multiply(marketCap, (LIQUIDITY_DEPTH_TARGET / 100));
    
    // Verifica che ci sia liquidità sufficiente
    if (this.liquidityPool.usdc < MIN_LIQUIDITY_THRESHOLD) {
      console.warn(`Liquidità USDC insufficiente: ${this.liquidityPool.usdc} < ${MIN_LIQUIDITY_THRESHOLD}`);
      // Aumenta lo spread in caso di bassa liquidità
      const adjustedHalfSpread = this.math.clamp(halfSpread * 2, 0.5, 10);
      bidPrice = this.math.multiply(this.currentPrice, (1 - adjustedHalfSpread / 100));
      askPrice = this.math.multiply(this.currentPrice, (1 + adjustedHalfSpread / 100));
    }
    
    // Genera ordini di acquisto (bids) con distribuzione esponenziale
    let remainingBidLiquidity = this.math.multiply(this.liquidityPool.usdc, 0.5); // Usa metà della liquidità USDC per gli ordini di acquisto
    let currentBidPrice = bidPrice;
    
    // Calcola la dimensione massima dell'ordine come percentuale della liquidità totale
    const maxBidOrderSize = this.math.multiply(remainingBidLiquidity, (MAX_ORDER_SIZE_PERCENTAGE / 100));
    
    for (let i = 0; i < 10; i++) {
      // Usa una distribuzione esponenziale per concentrare più liquidità vicino al prezzo corrente
      const orderSizePercentage = 0.4 * Math.exp(-0.3 * i);
      const orderSize = this.math.clamp(
        this.math.multiply(remainingBidLiquidity, orderSizePercentage),
        0,
        maxBidOrderSize
      );
      
      if (orderSize <= 0) continue;
      
      this.orderBook.bids.push({
        price: currentBidPrice,
        size: this.math.divide(orderSize, currentBidPrice), // Converti USDC in token
        total: orderSize,
        id: `bid_${Date.now()}_${i}`
      });
      
      remainingBidLiquidity = this.math.clamp(remainingBidLiquidity - orderSize, 0, remainingBidLiquidity);
      // Diminuisci il prezzo con un fattore che aumenta con la distanza dal prezzo corrente
      const priceFactor = 0.99 - (i * 0.001);
      currentBidPrice = this.math.multiply(currentBidPrice, priceFactor);
    }
    
    // Genera ordini di vendita (asks) con distribuzione esponenziale
    let remainingAskLiquidity = this.math.multiply(this.liquidityPool.token, 0.5); // Usa metà della liquidità token per gli ordini di vendita
    let currentAskPrice = askPrice;
    
    // Calcola la dimensione massima dell'ordine come percentuale della liquidità totale
    const maxAskOrderSize = this.math.multiply(remainingAskLiquidity, (MAX_ORDER_SIZE_PERCENTAGE / 100));
    
    for (let i = 0; i < 10; i++) {
      // Usa una distribuzione esponenziale per concentrare più liquidità vicino al prezzo corrente
      const orderSizePercentage = 0.4 * Math.exp(-0.3 * i);
      const orderSize = this.math.clamp(
        this.math.multiply(remainingAskLiquidity, orderSizePercentage),
        0,
        maxAskOrderSize
      );
      
      if (orderSize <= 0) continue;
      
      this.orderBook.asks.push({
        price: currentAskPrice,
        size: orderSize,
        total: this.math.multiply(orderSize, currentAskPrice), // Converti token in USDC
        id: `ask_${Date.now()}_${i}`
      });
      
      remainingAskLiquidity = this.math.clamp(remainingAskLiquidity - orderSize, 0, remainingAskLiquidity);
      // Aumenta il prezzo con un fattore che aumenta con la distanza dal prezzo corrente
      const priceFactor = 1.01 + (i * 0.001);
      currentAskPrice = this.math.multiply(currentAskPrice, priceFactor);
    }
    
    console.log(`Generati ${this.orderBook.bids.length} ordini di acquisto e ${this.orderBook.asks.length} ordini di vendita`);
    console.log(`Spread: ${SPREAD_TARGET}%, Prezzo bid: $${bidPrice}, Prezzo ask: $${askPrice}`);
  }
  
  // Avvia il ribilanciamento periodico
  startRebalancing() {
    console.log(`Avvio del ribilanciamento periodico ogni ${REBALANCE_INTERVAL / 1000 / 60} minuti`);
    
    // Ferma il ribilanciamento esistente se presente
    this.stopRebalancing();
    
    this.rebalanceInterval = setInterval(() => {
      try {
        this.rebalanceLiquidity();
      } catch (error) {
        console.error('Errore durante il ribilanciamento della liquidità:', error);
      }
    }, REBALANCE_INTERVAL);
  }
  
  // Ferma il ribilanciamento periodico
  stopRebalancing() {
    if (this.rebalanceInterval) {
      clearInterval(this.rebalanceInterval);
      this.rebalanceInterval = null;
      console.log('Ribilanciamento periodico fermato');
    }
  }
  
  // Ribilancia la liquidità in base al prezzo di mercato
  async rebalanceLiquidity() {
    console.log('Ribilanciamento della liquidità...');
    
    // Se il circuit breaker è attivo, non fare nulla
    if (this.circuitBreakerActive) {
      console.log('Circuit breaker attivo, ribilanciamento saltato');
      return;
    }
    
    // Ottieni il prezzo di mercato (in un'implementazione reale, questo verrebbe ottenuto da un oracolo o da un DEX)
    const marketPrice = this.getMarketPrice();
    
    // Calcola la variazione di prezzo
    const priceChange = this.math.percentageChange(this.currentPrice, marketPrice);
    
    console.log(`Prezzo di mercato: $${marketPrice}, Prezzo corrente: $${this.currentPrice}, Variazione: ${priceChange.toFixed(2)}%`);
    
    // Verifica se la variazione di prezzo è anomala
    if (this.isAnomalousPrice(marketPrice)) {
      console.warn(`Rilevata variazione di prezzo anomala: ${priceChange.toFixed(2)}%`);
      this.manipulationAttempts++;
      
      // Se ci sono stati troppi tentativi di manipolazione, attiva il circuit breaker
      if (this.manipulationAttempts >= 3) {
        this.activateCircuitBreaker('Troppi tentativi di manipolazione del prezzo');
        return;
      }
      
      // Usa un prezzo più conservativo
      const conservativePrice = this.getConservativePrice();
      console.log(`Usando prezzo conservativo: $${conservativePrice} invece di $${marketPrice}`);
      
      // Aggiorna il prezzo corrente con un movimento limitato
      const maxChange = this.math.multiply(this.currentPrice, (MAX_PRICE_CHANGE_PER_REBALANCE / 100));
      const priceDiff = marketPrice - this.currentPrice;
      const limitedDiff = this.math.clamp(priceDiff, -maxChange, maxChange);
      this.currentPrice = this.math.add(this.currentPrice, limitedDiff);
    } else if (priceChange > PRICE_STABILITY_THRESHOLD) {
      console.log(`Variazione di prezzo superiore alla soglia (${PRICE_STABILITY_THRESHOLD}%), aggiornamento del prezzo corrente`);
      
      // Limita la variazione di prezzo per evitare movimenti bruschi
      const maxChange = this.math.multiply(this.currentPrice, (MAX_PRICE_CHANGE_PER_REBALANCE / 100));
      const priceDiff = marketPrice - this.currentPrice;
      const limitedDiff = this.math.clamp(priceDiff, -maxChange, maxChange);
      this.currentPrice = this.math.add(this.currentPrice, limitedDiff);
      
      // Resetta il contatore dei tentativi di manipolazione
      this.manipulationAttempts = 0;
    } else {
      console.log(`Variazione di prezzo entro la soglia (${PRICE_STABILITY_THRESHOLD}%), nessun aggiornamento necessario`);
      // Resetta il contatore dei tentativi di manipolazione
      this.manipulationAttempts = 0;
    }
    
    // Registra il nuovo prezzo
    this.priceHistory.push({
      price: this.currentPrice,
      timestamp: new Date().toISOString()
    });
    
    // Limita la dimensione della storia dei prezzi
    if (this.priceHistory.length > 100) {
      this.priceHistory = this.priceHistory.slice(-100);
    }
    
    // Rigenera gli ordini
    await this.generateOrders();
  }
  
  // Ottieni il prezzo di mercato (in un'implementazione reale, questo verrebbe ottenuto da un oracolo o da un DEX)
  getMarketPrice() {
    // Simula una variazione casuale del prezzo entro il ±5%
    const randomVariation = this.math.clamp((Math.random() * 10 - 5) / 100, -0.05, 0.05);
    return this.math.multiply(this.currentPrice, (1 + randomVariation));
  }
  
  // Verifica se un prezzo è anomalo rispetto alla storia recente
  isAnomalousPrice(price) {
    if (!this.anomalyDetectionEnabled || this.priceHistory.length < PRICE_ANOMALY_WINDOW) {
      return false;
    }
    
    // Calcola la media e la deviazione standard dei prezzi recenti
    const recentPrices = this.priceHistory.slice(-PRICE_ANOMALY_WINDOW).map(entry => entry.price);
    const mean = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / recentPrices.length;
    const stdDev = Math.sqrt(variance);
    
    // Calcola lo z-score del nuovo prezzo
    const zScore = Math.abs((price - mean) / (stdDev || 1)); // Evita divisione per zero
    
    // Un z-score superiore a 3 è considerato anomalo (99.7% dei dati normali sono entro 3 deviazioni standard)
    return zScore > 3;
  }
  
  // Ottieni un prezzo conservativo basato sulla storia recente
  getConservativePrice() {
    if (this.priceHistory.length < 3) {
      return this.currentPrice;
    }
    
    // Usa la mediana degli ultimi 3 prezzi
    const recentPrices = this.priceHistory.slice(-3).map(entry => entry.price);
    recentPrices.sort((a, b) => a - b);
    return recentPrices[Math.floor(recentPrices.length / 2)];
  }
  
  // Attiva il circuit breaker
  activateCircuitBreaker(reason) {
    if (this.circuitBreakerActive) {
      return;
    }
    
    console.warn(`Circuit breaker attivato: ${reason}`);
    this.circuitBreakerActive = true;
    
    // Imposta un timeout per disattivare il circuit breaker
    this.circuitBreakerTimeout = setTimeout(() => {
      console.log('Circuit breaker disattivato');
      this.circuitBreakerActive = false;
      this.manipulationAttempts = 0;
    }, CIRCUIT_BREAKER_COOLDOWN);
  }
  
  // Verifica se un ordine potrebbe causare un impatto significativo sul prezzo
  wouldCauseSignificantPriceImpact(side, amount) {
    const orders = side === 'buy' ? this.orderBook.asks : this.orderBook.bids;
    
    // Calcola la liquidità totale disponibile
    const totalLiquidity = orders.reduce((sum, order) => {
      return this.math.add(sum, side === 'buy' ? order.total : order.size);
    }, 0);
    
    // Calcola l'impatto percentuale dell'ordine sulla liquidità totale
    const impact = this.math.divide(amount, totalLiquidity) * 100;
    
    return impact > PRICE_IMPACT_THRESHOLD;
  }
  
  // Verifica se c'è un'attività di trading sospetta (trading ad alta frequenza)
  isSuspiciousTradingActivity() {
    const now = Date.now();
    
    // Aggiungi il timestamp corrente
    this.lastTradeTimestamps.push(now);
    
    // Mantieni solo gli ultimi 10 timestamp
    if (this.lastTradeTimestamps.length > 10) {
      this.lastTradeTimestamps = this.lastTradeTimestamps.slice(-10);
    }
    
    // Se ci sono meno di 5 trade, non è sospetto
    if (this.lastTradeTimestamps.length < 5) {
      return false;
    }
    
    // Calcola l'intervallo medio tra i trade
    const intervals = [];
    for (let i = 1; i < this.lastTradeTimestamps.length; i++) {
      intervals.push(this.lastTradeTimestamps[i] - this.lastTradeTimestamps[i-1]);
    }
    
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    
    // Se l'intervallo medio è troppo piccolo (meno di 1 secondo), è sospetto
    return averageInterval < 1000;
  }
  
  // Esegue un ordine di mercato
  async executeMarketOrder(side, amount) {
    // Validazione degli input
    if (side !== 'buy' && side !== 'sell') {
      throw new Error('side deve essere "buy" o "sell"');
    }
    
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new Error('amount deve essere un numero positivo');
    }
    
    console.log(`Esecuzione ordine di mercato: ${side}, ${amount} ${side === 'buy' ? 'USDC' : 'token'}`);
    
    // Se il circuit breaker è attivo, rifiuta l'ordine
    if (this.circuitBreakerActive) {
      throw new Error('Circuit breaker attivo, ordine rifiutato');
    }
    
    // Verifica se l'ordine causerebbe un impatto significativo sul prezzo
    if (this.wouldCauseSignificantPriceImpact(side, amount)) {
      console.warn(`Ordine rifiutato: causerebbe un impatto significativo sul prezzo (> ${PRICE_IMPACT_THRESHOLD}%)`);
      this.manipulationAttempts++;
      
      if (this.manipulationAttempts >= 3) {
        this.activateCircuitBreaker('Troppi tentativi di manipolazione del prezzo');
      }
      
      throw new Error(`Ordine rifiutato: dimensione troppo grande rispetto alla liquidità disponibile`);
    }
    
    // Verifica se c'è un'attività di trading sospetta
    if (this.isSuspiciousTradingActivity()) {
      console.warn('Rilevata attività di trading sospetta (alta frequenza)');
      this.manipulationAttempts++;
      
      if (this.manipulationAttempts >= 3) {
        this.activateCircuitBreaker('Attività di trading sospetta');
        throw new Error('Ordine rifiutato: attività di trading sospetta');
      }
    }
    
    const orders = side === 'buy' ? this.orderBook.asks : this.orderBook.bids;
    let remainingAmount = amount;
    let totalExecuted = 0;
    let averagePrice = 0;
    let totalCost = 0;
    
    // Ordina gli ordini per prezzo (dal migliore al peggiore)
    const sortedOrders = [...orders].sort((a, b) => {
      return side === 'buy' ? a.price - b.price : b.price - a.price;
    });
    
    // Esegui gli ordini fino a soddisfare l'importo richiesto
    for (const order of sortedOrders) {
      if (remainingAmount <= 0) break;
      
      // Calcola quanto dell'ordine può essere eseguito
      const executeAmount = Math.min(remainingAmount, side === 'buy' ? order.total : order.size);
      const executeSize = side === 'buy' ? this.math.divide(executeAmount, order.price) : executeAmount;
      const executeCost = side === 'buy' ? executeAmount : this.math.multiply(executeAmount, order.price);
      
      console.log(`Esecuzione parziale: ${executeSize} token a $${order.price}, costo: $${executeCost}`);
      
      // Aggiorna i totali
      totalExecuted = this.math.add(totalExecuted, executeSize);
      totalCost = this.math.add(totalCost, executeCost);
      remainingAmount = this.math.clamp(remainingAmount - (side === 'buy' ? executeAmount : executeSize), 0, remainingAmount);
      
      // Aggiorna l'ordine
      if (side === 'buy') {
        order.size = this.math.clamp(order.size - executeSize, 0, order.size);
        order.total = this.math.clamp(order.total - executeAmount, 0, order.total);
      } else {
        order.size = this.math.clamp(order.size - executeAmount, 0, order.size);
        order.total = this.math.clamp(order.total - executeCost, 0, order.total);
      }
      
      // Rimuovi l'ordine se è stato completamente eseguito
      if (order.size <= 0) {
        const index = orders.findIndex(o => o.id === order.id);
        if (index !== -1) {
          orders.splice(index, 1);
        }
      }
    }
    
    // Calcola il prezzo medio
    averagePrice = totalExecuted > 0 ? this.math.divide(totalCost, totalExecuted) : 0;
    
    // Aggiorna il pool di liquidità
    if (side === 'buy') {
      this.liquidityPool.token = this.math.clamp(this.liquidityPool.token - totalExecuted, 0, this.liquidityPool.token);
      this.liquidityPool.usdc = this.math.add(this.liquidityPool.usdc, totalCost);
    } else {
      this.liquidityPool.token = this.math.add(this.liquidityPool.token, totalExecuted);
      this.liquidityPool.usdc = this.math.clamp(this.liquidityPool.usdc - totalCost, 0, this.liquidityPool.usdc);
    }
    
    console.log(`Ordine eseguito: ${totalExecuted} token a prezzo medio $${averagePrice}, costo totale: $${totalCost}`);
    
    // Aggiorna la storia del volume
    this.volumeHistory.push({
      volume: totalCost,
      timestamp: new Date().toISOString()
    });
    
    // Limita la dimensione della storia del volume
    if (this.volumeHistory.length > 100) {
      this.volumeHistory = this.volumeHistory.slice(-100);
    }
    
    // Verifica se il volume è anomalo
    if (this.isAnomalousVolume(totalCost)) {
      console.warn(`Rilevato volume anomalo: $${totalCost}`);
      this.manipulationAttempts++;
      
      if (this.manipulationAttempts >= 3) {
        this.activateCircuitBreaker('Volume di trading anomalo');
      }
    }
    
    // Rigenera gli ordini se necessario
    if (orders.length < 5) {
      console.log('Pochi ordini rimanenti, rigenerazione degli ordini...');
      await this.generateOrders();
    }
    
    return {
      side,
      amountRequested: amount,
      amountExecuted: totalExecuted,
      averagePrice,
      totalCost,
      timestamp: new Date().toISOString()
    };
  }
  
  // Verifica se un volume è anomalo rispetto alla storia recente
  isAnomalousVolume(volume) {
    if (this.volumeHistory.length < 10) {
      return false;
    }
    
    // Calcola il volume medio degli ultimi 10 trade
    const recentVolumes = this.volumeHistory.slice(-10).map(entry => entry.volume);
    const averageVolume = recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length;
    
    // Un volume superiore a VOLUME_ANOMALY_THRESHOLD volte la media è considerato anomalo
    return volume > averageVolume * VOLUME_ANOMALY_THRESHOLD;
  }
  
  // Ottieni lo stato attuale del market maker
  getStatus() {
    const bidPrice = this.orderBook.bids.length > 0 ? 
      Math.max(...this.orderBook.bids.map(order => order.price)) : 0;
    
    const askPrice = this.orderBook.asks.length > 0 ? 
      Math.min(...this.orderBook.asks.map(order => order.price)) : 0;
    
    const spread = bidPrice > 0 && askPrice > 0 ? 
      this.math.divide(askPrice - bidPrice, bidPrice) * 100 : 0;
    
    const totalBidLiquidity = this.orderBook.bids.reduce((sum, order) => this.math.add(sum, order.total), 0);
    const totalAskLiquidity = this.orderBook.asks.reduce((sum, order) => this.math.add(sum, this.math.multiply(order.size, order.price)), 0);
    
    return {
      currentPrice: this.currentPrice,
      bidPrice,
      askPrice,
      spread,
      orderBook: {
        bids: this.orderBook.bids.length,
        asks: this.orderBook.asks.length
      },
      liquidityPool: this.liquidityPool,
      liquidityDepth: {
        bids: totalBidLiquidity,
        asks: totalAskLiquidity,
        total: this.math.add(totalBidLiquidity, totalAskLiquidity)
      },
      circuitBreakerActive: this.circuitBreakerActive,
      manipulationAttempts: this.manipulationAttempts,
      lastUpdate: new Date().toISOString()
    };
  }
}

// Funzione per deployare il Market Maker
async function deployMarketMaker(tokenAddress) {
  console.log('Iniziando il deployment del Market Maker...');
  
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
  
  // Crea un'istanza del Market Maker
  const marketMaker = new MarketMaker(connection, tokenPubkey);
  
  // Inizializza il Market Maker con valori di esempio
  const initialTokenAmount = 10000000; // 10 milioni di token
  const initialUsdcAmount = 100000; // 100,000 USDC
  const initialPrice = 0.01; // $0.01 per token
  
  // In un'implementazione reale, qui trasferiremmo effettivamente i token e USDC al market maker
  
  // Salva le informazioni del Market Maker
  const marketMakerInfo = {
    tokenAddress: tokenPubkey.toString(),
    priceStabilityThreshold: PRICE_STABILITY_THRESHOLD,
    liquidityDepthTarget: LIQUIDITY_DEPTH_TARGET,
    spreadTarget: SPREAD_TARGET,
    rebalanceInterval: REBALANCE_INTERVAL / 1000 / 60, // Converti in minuti
    maxPriceChangePerRebalance: MAX_PRICE_CHANGE_PER_REBALANCE,
    priceImpactThreshold: PRICE_IMPACT_THRESHOLD,
    minLiquidityThreshold: MIN_LIQUIDITY_THRESHOLD,
    circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
    circuitBreakerCooldown: CIRCUIT_BREAKER_COOLDOWN / 1000 / 60, // Converti in minuti
    volumeAnomalyThreshold: VOLUME_ANOMALY_THRESHOLD,
    priceAnomalyWindow: PRICE_ANOMALY_WINDOW,
    maxOrderSizePercentage: MAX_ORDER_SIZE_PERCENTAGE,
    initialConfig: {
      tokenAmount: initialTokenAmount,
      usdcAmount: initialUsdcAmount,
      initialPrice
    },
    deploymentTimestamp: new Date().toISOString(),
    deployer: walletKeypair.publicKey.toString()
  };
  
  // Salva le informazioni in un file JSON
  const infoPath = path.join(__dirname, '../deployment-info/market_maker_info.json');
  fs.mkdirSync(path.dirname(infoPath), { recursive: true });
  fs.writeFileSync(infoPath, JSON.stringify(marketMakerInfo, null, 2));
  
  console.log(`Market Maker deployato con successo per il token: ${tokenPubkey.toString()}`);
  console.log(`Informazioni salvate in: ${infoPath}`);
  
  return marketMakerInfo;
}

// Esporta la classe e la funzione di deployment
module.exports = {
  MarketMaker,
  deployMarketMaker
};

// Se eseguito direttamente, esegui il deployment
if (require.main === module) {
  // Prendi l'indirizzo del token come argomento
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.error('Errore: Indirizzo del token non specificato');
    console.log('Uso: node market_maker.js <indirizzo_token>');
    process.exit(1);
  }
  
  deployMarketMaker(tokenAddress)
    .then(info => {
      console.log('Market Maker deployato con successo!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Errore durante il deployment del Market Maker:', error);
      process.exit(1);
    });
}
