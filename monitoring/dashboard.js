// Sistema di monitoraggio avanzato per BuyBot
// Questo modulo fornisce un dashboard in tempo reale per monitorare lo stato del token BuyBot

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { Connection, PublicKey } = require('@solana/web3.js');

// Configurazione
const PORT = process.env.PORT || 3000;
const LOG_DIR = path.join(__dirname, 'logs');
const METRICS_INTERVAL = 5000; // 5 secondi

// Assicurati che la directory dei log esista
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Configurazione del logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'monitoring-system' },
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'combined.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Classe per il sistema di monitoraggio
class MonitoringSystem {
  constructor(config) {
    this.config = config;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server);
    this.metrics = {
      system: {
        cpuUsage: 0,
        memoryUsage: 0,
        networkLatency: 0,
        errorRate: 0,
        responseTime: 0
      },
      token: {
        price: 0,
        marketcap: 0,
        holders: 0,
        transactions: 0,
        volume: 0
      },
      boost: {
        enabled: false,
        currentPhase: '',
        transactionCount: 0,
        lastBoostTime: 0,
        boostHistory: []
      },
      bundle: {
        pendingTransactions: 0,
        executedBundles: 0,
        totalTransactionsExecuted: 0,
        bundleInProgress: false
      }
    };
    
    this.setupExpress();
    this.setupSocketIO();
    this.setupMetricsCollection();
    
    logger.info('Sistema di monitoraggio inizializzato');
  }
  
  // Configura Express
  setupExpress() {
    // Servi i file statici dalla directory 'public'
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Rotta principale
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    // API per ottenere le metriche correnti
    this.app.get('/api/metrics', (req, res) => {
      res.json(this.metrics);
    });
    
    // API per ottenere lo storico delle metriche
    this.app.get('/api/metrics/history', (req, res) => {
      const historyFile = path.join(LOG_DIR, 'metrics_history.json');
      
      if (fs.existsSync(historyFile)) {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        res.json(history);
      } else {
        res.json([]);
      }
    });
    
    logger.info('Express configurato');
  }
  
  // Configura Socket.IO
  setupSocketIO() {
    this.io.on('connection', (socket) => {
      logger.info(`Nuovo client connesso: ${socket.id}`);
      
      // Invia le metriche correnti al client appena connesso
      socket.emit('metrics', this.metrics);
      
      // Gestisci la disconnessione
      socket.on('disconnect', () => {
        logger.info(`Client disconnesso: ${socket.id}`);
      });
    });
    
    logger.info('Socket.IO configurato');
  }
  
  // Configura la raccolta delle metriche
  setupMetricsCollection() {
    // Raccolta periodica delle metriche
    setInterval(() => {
      this.collectMetrics();
      this.io.emit('metrics', this.metrics);
    }, METRICS_INTERVAL);
    
    logger.info(`Raccolta metriche configurata (intervallo: ${METRICS_INTERVAL}ms)`);
  }
  
  // Raccoglie le metriche
  async collectMetrics() {
    try {
      // Simula la raccolta delle metriche di sistema
      this.metrics.system.cpuUsage = Math.random() * 100;
      this.metrics.system.memoryUsage = Math.random() * 100;
      this.metrics.system.networkLatency = Math.random() * 100;
      this.metrics.system.errorRate = Math.random() * 1;
      this.metrics.system.responseTime = Math.random() * 5000;
      
      // In un'implementazione reale, qui raccoglieremmo le metriche effettive
      // dal sistema, dal token, dal boost manager e dal bundle engine
      
      // Salva le metriche nella cronologia
      this.saveMetricsToHistory();
      
      logger.debug('Metriche raccolte con successo');
    } catch (error) {
      logger.error(`Errore durante la raccolta delle metriche: ${error.message}`);
    }
  }
  
  // Aggiorna le metriche del token
  updateTokenMetrics(tokenMetrics) {
    this.metrics.token = { ...this.metrics.token, ...tokenMetrics };
    this.io.emit('metrics', this.metrics);
    logger.debug('Metriche del token aggiornate', { metrics: this.metrics.token });
  }
  
  // Aggiorna le metriche del boost
  updateBoostMetrics(boostMetrics) {
    this.metrics.boost = { ...this.metrics.boost, ...boostMetrics };
    this.io.emit('metrics', this.metrics);
    logger.debug('Metriche del boost aggiornate', { metrics: this.metrics.boost });
  }
  
  // Aggiorna le metriche del bundle
  updateBundleMetrics(bundleMetrics) {
    this.metrics.bundle = { ...this.metrics.bundle, ...bundleMetrics };
    this.io.emit('metrics', this.metrics);
    logger.debug('Metriche del bundle aggiornate', { metrics: this.metrics.bundle });
  }
  
  // Salva le metriche nella cronologia
  saveMetricsToHistory() {
    const historyFile = path.join(LOG_DIR, 'metrics_history.json');
    const timestamp = Date.now();
    const metricsWithTimestamp = { timestamp, ...this.metrics };
    
    try {
      let history = [];
      
      if (fs.existsSync(historyFile)) {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      }
      
      // Limita la dimensione della cronologia a 1000 entry
      if (history.length >= 1000) {
        history.shift(); // Rimuovi l'entry più vecchia
      }
      
      history.push(metricsWithTimestamp);
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
      
      logger.debug('Metriche salvate nella cronologia');
    } catch (error) {
      logger.error(`Errore durante il salvataggio delle metriche nella cronologia: ${error.message}`);
    }
  }
  
  // Genera un avviso
  generateAlert(type, message, level = 'info') {
    const alert = {
      type,
      message,
      level,
      timestamp: Date.now()
    };
    
    // Emetti l'avviso ai client
    this.io.emit('alert', alert);
    
    // Registra l'avviso nel log
    logger[level](`Avviso: ${message}`, { type });
    
    return alert;
  }
  
  // Avvia il server
  start() {
    this.server.listen(PORT, () => {
      logger.info(`Server di monitoraggio avviato sulla porta ${PORT}`);
    });
  }
  
  // Ferma il server
  stop() {
    this.server.close(() => {
      logger.info('Server di monitoraggio fermato');
    });
  }
}

// Crea un'istanza del sistema di monitoraggio
const createMonitoringSystem = (config = {}) => {
  return new MonitoringSystem(config);
};

// Esporta il modulo
module.exports = {
  createMonitoringSystem,
  MonitoringSystem,
  logger
};

// Se eseguito direttamente, avvia il server
if (require.main === module) {
  const monitoringSystem = createMonitoringSystem();
  monitoringSystem.start();
}
