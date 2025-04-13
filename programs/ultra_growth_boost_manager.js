// UltraGrowthBoostManager per Solana
// Questo programma implementa un meccanismo di boost avanzato con strategia a 4 fasi

const { PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Configurazione predefinita
const DEFAULT_CONFIG = {
  enabled: true,
  initialPrice: 0.000001,
  targetMarketcap: 20000000,
  totalSupply: 1000000000,
  phases: {
    microCap: { 
      threshold: 100000, 
      boostPercentage: 800, 
      transactionsRequired: 20,
      buyRatioTarget: 90,
      boostDecayFactor: 0.8,
      maxBoostsPerPhase: 5
    },
    smallCap: { 
      threshold: 1000000, 
      boostPercentage: 300, 
      transactionsRequired: 40,
      buyRatioTarget: 80,
      boostDecayFactor: 0.85,
      maxBoostsPerPhase: 8
    },
    midCap: { 
      threshold: 5000000, 
      boostPercentage: 150, 
      transactionsRequired: 60,
      buyRatioTarget: 70,
      boostDecayFactor: 0.9,
      maxBoostsPerPhase: 10
    },
    largeCap: { 
      threshold: 20000000, 
      boostPercentage: 80, 
      transactionsRequired: 100,
      buyRatioTarget: 60,
      boostDecayFactor: 0.95,
      maxBoostsPerPhase: 15
    }
  },
  minIntervalBetweenBoosts: 3600000, // 1 ora in ms
  maxBoostsPerDay: 24,
  debugMode: false
};

/**
 * Classe UltraGrowthBoostManager
 * Implementa un meccanismo di boost avanzato con strategia a 4 fasi per facilitare
 * la crescita del valore del token da micro-cap (1K) a large-cap (20M+)
 */
class UltraGrowthBoostManager {
  /**
   * Costruttore
   * @param {Object} config - Configurazione personalizzata (opzionale)
   */
  constructor(config = {}) {
    // Unisci la configurazione predefinita con quella personalizzata
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      phases: {
        ...DEFAULT_CONFIG.phases,
        ...(config.phases || {})
      }
    };
    
    // Inizializzazione dello stato
    this.transactionCount = 0;
    this.buyTransactionCount = 0;
    this.sellTransactionCount = 0;
    this.boostHistory = [];
    this.lastBoostTime = 0;
    this.currentPrice = this.config.initialPrice;
    this.currentStep = 0;
    this.dailyBoostCount = 0;
    this.lastDailyReset = Date.now();
    this.phaseBoostCounts = { microCap: 0, smallCap: 0, midCap: 0, largeCap: 0 };
    
    // Calcola i threshold di prezzo
    this.priceThresholds = this.calculatePriceThresholds();
    
    console.log(`UltraGrowthBoostManager inizializzato con prezzo iniziale: ${this.currentPrice}`);
    console.log(`Target marketcap: ${this.config.targetMarketcap}`);
    console.log(`Fasi configurate: ${Object.keys(this.config.phases).join(', ')}`);
  }
  
  /**
   * Calcola i threshold di prezzo per ogni fase
   * @returns {Array} Array di threshold di prezzo
   */
  calculatePriceThresholds() {
    const thresholds = [];
    const phases = ['microCap', 'smallCap', 'midCap', 'largeCap'];
    
    // Aggiungi il prezzo iniziale
    thresholds.push(this.config.initialPrice);
    
    // Calcola i threshold per ogni fase
    for (const phase of phases) {
      const phaseConfig = this.config.phases[phase];
      const phaseMarketcap = phaseConfig.threshold;
      const phasePrice = phaseMarketcap / this.config.totalSupply;
      
      // Calcola i threshold intermedi per questa fase
      const boostsInPhase = phaseConfig.maxBoostsPerPhase;
      const startPrice = thresholds[thresholds.length - 1];
      const priceDiff = phasePrice - startPrice;
      
      for (let i = 1; i <= boostsInPhase; i++) {
        // Distribuzione esponenziale dei threshold all'interno della fase
        const t = i / boostsInPhase;
        const factor = Math.pow(t, 1.5);
        const price = startPrice + priceDiff * factor;
        thresholds.push(price);
      }
    }
    
    if (this.config.debugMode) {
      console.log('Threshold di prezzo calcolati:');
      thresholds.forEach((price, index) => {
        console.log(`Step ${index}: ${price}`);
      });
    }
    
    return thresholds;
  }
  
  /**
   * Determina la fase di marketcap corrente
   * @returns {string} Nome della fase corrente
   */
  getCurrentCapPhase() {
    const currentMarketcap = this.currentPrice * this.config.totalSupply;
    const phases = ['microCap', 'smallCap', 'midCap', 'largeCap'];
    
    // Trova la fase corrente in base al marketcap
    for (let i = phases.length - 1; i >= 0; i--) {
      const phase = phases[i];
      if (currentMarketcap < this.config.phases[phase].threshold) {
        if (i > 0) {
          return phases[i - 1];
        }
      }
    }
    
    // Se il marketcap è superiore a tutte le soglie, siamo nella fase finale
    if (currentMarketcap >= this.config.phases.largeCap.threshold) {
      return 'largeCap';
    }
    
    return 'microCap'; // Fase predefinita
  }
  
  /**
   * Ottiene la configurazione della fase corrente
   * @returns {Object} Configurazione della fase corrente
   */
  getCurrentPhaseConfig() {
    const phase = this.getCurrentCapPhase();
    return this.config.phases[phase];
  }
  
  /**
   * Ottiene la soglia della prossima fase
   * @returns {number|null} Soglia della prossima fase o null se siamo nell'ultima fase
   */
  getNextPhaseThreshold() {
    const currentPhase = this.getCurrentCapPhase();
    const phases = ['microCap', 'smallCap', 'midCap', 'largeCap'];
    const currentIndex = phases.indexOf(currentPhase);
    
    if (currentIndex < phases.length - 1) {
      const nextPhase = phases[currentIndex + 1];
      return this.config.phases[nextPhase].threshold;
    }
    
    return null;
  }
  
  /**
   * Calcola la percentuale di boost in base alla fase corrente
   * @returns {number} Percentuale di boost
   */
  calculateBoostPercentage() {
    const phase = this.getCurrentCapPhase();
    const phaseConfig = this.config.phases[phase];
    const boostsInPhase = this.phaseBoostCounts[phase];
    
    // Calcola la percentuale di boost con decadimento
    let decayFactor = Math.pow(phaseConfig.boostDecayFactor, boostsInPhase);
    let boostPercentage = phaseConfig.boostPercentage * decayFactor;
    
    // Boost adattivo: aumenta il boost se siamo lontani dal target
    const currentMarketcap = this.currentPrice * this.config.totalSupply;
    const distanceToTarget = this.config.targetMarketcap - currentMarketcap;
    const targetPercentage = distanceToTarget / this.config.targetMarketcap;
    
    // Aumenta il boost se siamo lontani dal target (max +100%)
    if (targetPercentage > 0.5) {
      const adaptiveBonus = Math.min(targetPercentage * 200, 100);
      boostPercentage += adaptiveBonus;
      
      if (this.config.debugMode) {
        console.log(`Boost adattivo applicato: +${adaptiveBonus.toFixed(2)}% (distanza dal target: ${(targetPercentage * 100).toFixed(2)}%)`);
      }
    }
    
    // Boost speciale per la transizione tra fasi
    const nextPhaseThreshold = this.getNextPhaseThreshold();
    if (nextPhaseThreshold && currentMarketcap >= 0.9 * nextPhaseThreshold) {
      const transitionMultiplier = 1.5;
      boostPercentage *= transitionMultiplier;
      
      if (this.config.debugMode) {
        console.log(`Boost di transizione applicato: moltiplicatore ${transitionMultiplier}x (vicino alla soglia della prossima fase)`);
      }
    }
    
    // Boost basato sul rapporto acquisti/vendite
    const totalTransactions = this.buyTransactionCount + this.sellTransactionCount;
    if (totalTransactions > 0) {
      const buyRatio = (this.buyTransactionCount / totalTransactions) * 100;
      const buyRatioTarget = phaseConfig.buyRatioTarget;
      
      if (buyRatio >= buyRatioTarget) {
        const buyRatioBonus = Math.min((buyRatio - buyRatioTarget) * 2, 50);
        boostPercentage += buyRatioBonus;
        
        if (this.config.debugMode) {
          console.log(`Bonus rapporto acquisti applicato: +${buyRatioBonus.toFixed(2)}% (rapporto acquisti: ${buyRatio.toFixed(2)}%)`);
        }
      }
    }
    
    return boostPercentage;
  }
  
  /**
   * Incrementa il contatore delle transazioni
   * @param {number} count - Numero di transazioni da aggiungere (default: 1)
   * @param {string} type - Tipo di transazione ('buy' o 'sell')
   * @returns {number} Nuovo contatore delle transazioni
   */
  incrementTransactionCount(count = 1, type = null) {
    this.transactionCount += count;
    
    // Aggiorna i contatori specifici per tipo
    if (type === 'buy') {
      this.buyTransactionCount += count;
    } else if (type === 'sell') {
      this.sellTransactionCount += count;
    }
    
    // Resetta il contatore giornaliero se necessario
    const now = Date.now();
    if (now - this.lastDailyReset > 86400000) { // 24 ore in ms
      this.dailyBoostCount = 0;
      this.lastDailyReset = now;
    }
    
    return this.transactionCount;
  }
  
  /**
   * Aggiorna il prezzo corrente
   * @param {number} price - Nuovo prezzo
   * @returns {number} Prezzo aggiornato
   */
  updateCurrentPrice(price) {
    if (typeof price !== 'number' || isNaN(price) || price <= 0) {
      throw new Error('Il prezzo deve essere un numero positivo');
    }
    
    const oldPrice = this.currentPrice;
    this.currentPrice = price;
    
    // Aggiorna anche lo step corrente quando il prezzo cambia
    this.updateCurrentStep();
    
    if (this.config.debugMode) {
      console.log(`Prezzo aggiornato: ${oldPrice} -> ${this.currentPrice}`);
    }
    
    return this.currentPrice;
  }
  
  /**
   * Aggiorna lo step corrente in base al prezzo
   * @returns {number} Step corrente
   */
  updateCurrentStep() {
    const oldStep = this.currentStep;
    
    // Trova lo step corrente in base al prezzo
    for (let i = this.priceThresholds.length - 1; i >= 0; i--) {
      if (this.currentPrice >= this.priceThresholds[i]) {
        this.currentStep = i;
        
        if (this.config.debugMode && oldStep !== i) {
          console.log(`Step aggiornato: ${oldStep} -> ${this.currentStep}`);
        }
        
        return this.currentStep;
      }
    }
    
    this.currentStep = 0;
    return this.currentStep;
  }
  
  /**
   * Verifica se è possibile attivare un boost
   * @returns {boolean} True se è possibile attivare un boost, false altrimenti
   */
  canBoost() {
    if (!this.config.enabled) {
      if (this.config.debugMode) {
        console.log('Boost disabilitato nella configurazione');
      }
      return false;
    }
    
    // Verifica l'intervallo minimo tra boost
    const timeSinceLastBoost = Date.now() - this.lastBoostTime;
    if (timeSinceLastBoost < this.config.minIntervalBetweenBoosts) {
      if (this.config.debugMode) {
        console.log(`Intervallo minimo tra boost non raggiunto. Tempo trascorso: ${timeSinceLastBoost}ms, richiesto: ${this.config.minIntervalBetweenBoosts}ms`);
      }
      return false;
    }
    
    // Verifica il numero massimo di boost giornalieri
    if (this.dailyBoostCount >= this.config.maxBoostsPerDay) {
      if (this.config.debugMode) {
        console.log(`Numero massimo di boost giornalieri raggiunto: ${this.dailyBoostCount}/${this.config.maxBoostsPerDay}`);
      }
      return false;
    }
    
    // Ottieni la configurazione della fase corrente
    const phaseConfig = this.getCurrentPhaseConfig();
    
    // Verifica se abbiamo raggiunto il numero di transazioni richieste per questa fase
    if (this.transactionCount < phaseConfig.transactionsRequired) {
      if (this.config.debugMode) {
        console.log(`Transazioni insufficienti: ${this.transactionCount}/${phaseConfig.transactionsRequired}`);
      }
      return false;
    }
    
    // Verifica se abbiamo raggiunto il numero massimo di boost per questa fase
    const phase = this.getCurrentCapPhase();
    if (this.phaseBoostCounts[phase] >= phaseConfig.maxBoostsPerPhase) {
      if (this.config.debugMode) {
        console.log(`Numero massimo di boost per la fase ${phase} raggiunto: ${this.phaseBoostCounts[phase]}/${phaseConfig.maxBoostsPerPhase}`);
      }
      return false;
    }
    
    return true;
  }
  
  /**
   * Verifica se è possibile attivare un boost manuale
   * @returns {boolean} True se è possibile attivare un boost manuale, false altrimenti
   */
  canManualBoost() {
    if (!this.config.enabled) {
      return false;
    }
    
    // Verifica l'intervallo minimo tra boost (metà del normale per i boost manuali)
    const timeSinceLastBoost = Date.now() - this.lastBoostTime;
    if (timeSinceLastBoost < this.config.minIntervalBetweenBoosts / 2) {
      return false;
    }
    
    // Verifica il numero massimo di boost giornalieri
    if (this.dailyBoostCount >= this.config.maxBoostsPerDay) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Attiva un boost automatico
   * @returns {Object|null} Informazioni sul boost attivato o null se non è possibile attivare un boost
   */
  activateBoost() {
    if (!this.canBoost()) {
      return null;
    }
    
    // Calcola la percentuale di boost per la fase corrente
    const boostPercentage = this.calculateBoostPercentage();
    
    // Calcola il nuovo prezzo dopo il boost
    const currentPrice = this.currentPrice;
    const boostFactor = 1 + (boostPercentage / 100);
    const newPrice = currentPrice * boostFactor;
    
    // Registra il boost
    const boost = {
      timestamp: Date.now(),
      step: this.currentStep,
      percentage: boostPercentage,
      priceBeforeBoost: currentPrice,
      priceAfterBoost: newPrice,
      transactionCount: this.transactionCount,
      buyTransactionCount: this.buyTransactionCount,
      sellTransactionCount: this.sellTransactionCount,
      marketcapBeforeBoost: currentPrice * this.config.totalSupply,
      marketcapAfterBoost: newPrice * this.config.totalSupply,
      phase: this.getCurrentCapPhase(),
      isManual: false
    };
    
    this.boostHistory.push(boost);
    this.lastBoostTime = boost.timestamp;
    this.transactionCount = 0;
    this.buyTransactionCount = 0;
    this.sellTransactionCount = 0;
    this.dailyBoostCount++;
    
    // Incrementa il contatore dei boost per questa fase
    const phase = this.getCurrentCapPhase();
    this.phaseBoostCounts[phase]++;
    
    // Aggiorna il prezzo corrente e lo step
    this.updateCurrentPrice(newPrice);
    
    console.log(`Boost attivato! Percentuale: ${boostPercentage.toFixed(2)}%, Prezzo: ${currentPrice} -> ${newPrice}`);
    console.log(`Fase: ${phase}, Boost in questa fase: ${this.phaseBoostCounts[phase]}`);
    
    return boost;
  }
  
  /**
   * Attiva un boost manuale con percentuale specificata
   * @param {number} percentage - Percentuale di boost
   * @returns {Object|null} Informazioni sul boost attivato o null se non è possibile attivare un boost
   */
  activateManualBoost(percentage) {
    if (!this.canManualBoost()) {
      return null;
    }
    
    if (typeof percentage !== 'number' || isNaN(percentage) || percentage <= 0) {
      throw new Error('La percentuale deve essere un numero positivo');
    }
    
    // Calcola il nuovo prezzo dopo il boost
    const currentPrice = this.currentPrice;
    const boostFactor = 1 + (percentage / 100);
    const newPrice = currentPrice * boostFactor;
    
    // Registra il boost
    const boost = {
      timestamp: Date.now(),
      step: this.currentStep,
      percentage: percentage,
      priceBeforeBoost: currentPrice,
      priceAfterBoost: newPrice,
      transactionCount: this.transactionCount,
      buyTransactionCount: this.buyTransactionCount,
      sellTransactionCount: this.sellTransactionCount,
      marketcapBeforeBoost: currentPrice * this.config.totalSupply,
      marketcapAfterBoost: newPrice * this.config.totalSupply,
      phase: this.getCurrentCapPhase(),
      isManual: true
    };
    
    this.boostHistory.push(boost);
    this.lastBoostTime = boost.timestamp;
    this.transactionCount = 0;
    this.buyTransactionCount = 0;
    this.sellTransactionCount = 0;
    this.dailyBoostCount++;
    
    // Incrementa il contatore dei boost per questa fase
    const phase = this.getCurrentCapPhase();
    this.phaseBoostCounts[phase]++;
    
    // Aggiorna il prezzo corrente e lo step
    this.updateCurrentPrice(newPrice);
    
    console.log(`Boost manuale attivato! Percentuale: ${percentage.toFixed(2)}%, Prezzo: ${currentPrice} -> ${newPrice}`);
    
    return boost;
  }
  
  /**
   * Ottiene lo stato attuale del boost
   * @returns {Object} Stato attuale del boost
   */
  getBoostStatus() {
    const currentPhase = this.getCurrentCapPhase();
    const phaseConfig = this.getCurrentPhaseConfig();
    const currentMarketcap = this.currentPrice * this.config.totalSupply;
    
    return {
      enabled: this.config.enabled,
      currentPrice: this.currentPrice,
      currentStep: this.currentStep,
      currentPhase,
      currentMarketcap,
      targetMarketcap: this.config.targetMarketcap,
      progressPercentage: (currentMarketcap / this.config.targetMarketcap) * 100,
      transactionCount: this.transactionCount,
      buyTransactionCount: this.buyTransactionCount,
      sellTransactionCount: this.sellTransactionCount,
      transactionsRequired: phaseConfig.transactionsRequired,
      transactionsRemaining: Math.max(0, phaseConfig.transactionsRequired - this.transactionCount),
      boostHistory: this.boostHistory,
      lastBoostTime: this.lastBoostTime,
      timeSinceLastBoost: Date.now() - this.lastBoostTime,
      timeUntilNextBoostEligibility: Math.max(0, this.config.minIntervalBetweenBoosts - (Date.now() - this.lastBoostTime)),
      dailyBoostCount: this.dailyBoostCount,
      maxBoostsPerDay: this.config.maxBoostsPerDay,
      phaseBoostCounts: this.phaseBoostCounts,
      maxBoostsPerPhase: phaseConfig.maxBoostsPerPhase,
      boostsRemainingInPhase: Math.max(0, phaseConfig.maxBoostsPerPhase - this.phaseBoostCounts[currentPhase]),
      nextPhaseThreshold: this.getNextPhaseThreshold(),
      priceThresholds: this.priceThresholds
    };
  }
  
  /**
   * Salva lo stato corrente su file
   * @param {string} filePath - Percorso del file
   * @returns {boolean} True se il salvataggio è riuscito, false altrimenti
   */
  saveState(filePath) {
    try {
      const state = {
        currentPrice: this.currentPrice,
        currentStep: this.currentStep,
        transactionCount: this.transactionCount,
        buyTransactionCount: this.buyTransactionCount,
        sellTransactionCount: this.sellTransactionCount,
        boostHistory: this.boostHistory,
        lastBoostTime: this.lastBoostTime,
        dailyBoostCount: this.dailyBoostCount,
        lastDailyReset: this.lastDailyReset,
        phaseBoostCounts: this.phaseBoostCounts
      };
      
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
      console.log(`Stato salvato su ${filePath}`);
      return true;
    } catch (error) {
      console.error(`Errore durante il salvataggio dello stato: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Carica lo stato da file
   * @param {string} filePath - Percorso del file
   * @returns {boolean} True se il caricamento è riuscito, false altrimenti
   */
  loadState(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`File non trovato: ${filePath}`);
        return false;
      }
      
      const stateData = fs.readFileSync(filePath, 'utf8');
      const state = JSON.parse(stateData);
      
      this.currentPrice = state.currentPrice;
      this.currentStep = state.currentStep;
      this.transactionCount = state.transactionCount;
      this.buyTransactionCount = state.buyTransactionCount;
      this.sellTransactionCount = state.sellTransactionCount;
      this.boostHistory = state.boostHistory;
      this.lastBoostTime = state.lastBoostTime;
      this.dailyBoostCount = state.dailyBoostCount;
      this.lastDailyReset = state.lastDailyReset;
      this.phaseBoostCounts = state.phaseBoostCounts;
      
      console.log(`Stato caricato da ${filePath}`);
      console.log(`Prezzo corrente: ${this.currentPrice}, Fase: ${this.getCurrentCapPhase()}`);
      return true;
    } catch (error) {
      console.error(`Errore durante il caricamento dello stato: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Genera un report dettagliato sulle prestazioni del boost
   * @returns {Object} Report dettagliato
   */
  generateReport() {
    const currentPhase = this.getCurrentCapPhase();
    const currentMarketcap = this.currentPrice * this.config.totalSupply;
    
    // Calcola statistiche sui boost
    const totalBoosts = this.boostHistory.length;
    const manualBoosts = this.boostHistory.filter(boost => boost.isManual).length;
    const autoBoosts = totalBoosts - manualBoosts;
    
    // Calcola la crescita totale
    const initialPrice = this.config.initialPrice;
    const priceGrowth = ((this.currentPrice / initialPrice) - 1) * 100;
    const marketcapGrowth = ((currentMarketcap / (initialPrice * this.config.totalSupply)) - 1) * 100;
    
    // Calcola la crescita media per boost
    const averageBoostPercentage = totalBoosts > 0 
      ? this.boostHistory.reduce((sum, boost) => sum + boost.percentage, 0) / totalBoosts 
      : 0;
    
    // Calcola il tempo medio tra boost
    let averageTimeBetweenBoosts = 0;
    if (this.boostHistory.length > 1) {
      let totalTime = 0;
      for (let i = 1; i < this.boostHistory.length; i++) {
        totalTime += this.boostHistory[i].timestamp - this.boostHistory[i-1].timestamp;
      }
      averageTimeBetweenBoosts = totalTime / (this.boostHistory.length - 1);
    }
    
    // Calcola statistiche per fase
    const phaseStats = {};
    for (const phase of Object.keys(this.config.phases)) {
      const phaseBoosts = this.boostHistory.filter(boost => boost.phase === phase);
      phaseStats[phase] = {
        boostCount: phaseBoosts.length,
        maxBoostsPerPhase: this.config.phases[phase].maxBoostsPerPhase,
        averageBoostPercentage: phaseBoosts.length > 0 
          ? phaseBoosts.reduce((sum, boost) => sum + boost.percentage, 0) / phaseBoosts.length 
          : 0,
        totalTransactions: phaseBoosts.reduce((sum, boost) => sum + boost.transactionCount, 0)
      };
    }
    
    return {
      currentPrice: this.currentPrice,
      currentMarketcap,
      targetMarketcap: this.config.targetMarketcap,
      progressPercentage: (currentMarketcap / this.config.targetMarketcap) * 100,
      currentPhase,
      initialPrice,
      priceGrowth,
      marketcapGrowth,
      totalBoosts,
      autoBoosts,
      manualBoosts,
      averageBoostPercentage,
      averageTimeBetweenBoosts,
      phaseStats,
      boostHistory: this.boostHistory
    };
  }
}

// Esporta la classe
module.exports = {
  UltraGrowthBoostManager,
  DEFAULT_CONFIG
};
