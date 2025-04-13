// Script di deploy per Solana devnet
// Questo script esegue il deploy del codice aggiornato su Solana devnet

const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { Token, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Importa i moduli di sicurezza
const SecureWalletManager = require('./wallet/secure_wallet_manager');
const { ScalableBundleEngine } = require('./programs/scalable_bundle_engine');
const { ErrorHandler, RecoveryManager } = require('./programs/recovery_system');

// Configurazione
const CONFIG = {
  RPC_URL: 'https://api.devnet.solana.com',
  WALLET_DIR: path.join(process.env.HOME, '.config', 'solana', 'secure'),
  LOG_DIR: path.join(process.cwd(), 'logs'),
  CHECKPOINT_DIR: path.join(process.cwd(), 'checkpoints'),
  TOKEN_ADDRESS: process.env.TOKEN_ADDRESS || '11111111111111111111111111111111', // Placeholder, sostituire con l'indirizzo reale
  WALLET_NAME: 'buybot_wallet',
  WALLET_PASSWORD: process.env.WALLET_PASSWORD || 'secure_password' // In produzione, usare variabili d'ambiente o un vault
};

// Inizializza il logger
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'buybot-deploy' },
  transports: [
    new winston.transports.File({ filename: path.join(CONFIG.LOG_DIR, 'deploy-error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(CONFIG.LOG_DIR, 'deploy.log') }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Funzione principale di deploy
async function deploy() {
  logger.info('Inizializzazione del deploy su Solana devnet');
  
  try {
    // Crea le directory necessarie
    ensureDirectoriesExist();
    
    // Inizializza i componenti
    const errorHandler = new ErrorHandler({ logDir: CONFIG.LOG_DIR });
    const recoveryManager = new RecoveryManager({ 
      checkpointDir: CONFIG.CHECKPOINT_DIR,
      errorHandler
    });
    
    // Crea un checkpoint iniziale
    const initialCheckpoint = recoveryManager.createCheckpoint('deploy_start', {
      timestamp: Date.now(),
      config: { ...CONFIG, WALLET_PASSWORD: '***REDACTED***' }
    });
    
    logger.info(`Checkpoint iniziale creato: ${initialCheckpoint.id}`);
    
    // Connessione a Solana
    const connection = new Connection(CONFIG.RPC_URL, 'confirmed');
    logger.info(`Connesso a Solana devnet: ${CONFIG.RPC_URL}`);
    
    // Verifica la connessione
    const version = await connection.getVersion();
    logger.info(`Versione Solana: ${JSON.stringify(version)}`);
    
    // Inizializza il wallet manager
    const walletManager = new SecureWalletManager(CONFIG.WALLET_DIR);
    
    // Verifica se il wallet esiste già
    let walletInfo;
    const wallets = walletManager.listWallets();
    const existingWallet = wallets.find(w => w.name === CONFIG.WALLET_NAME);
    
    if (existingWallet) {
      logger.info(`Wallet esistente trovato: ${CONFIG.WALLET_NAME}`);
      
      // Carica il wallet esistente
      const wallet = walletManager.loadWallet(CONFIG.WALLET_NAME, CONFIG.WALLET_PASSWORD);
      walletInfo = {
        name: CONFIG.WALLET_NAME,
        publicKey: wallet.publicKey.toString()
      };
    } else {
      // Importa il wallet dal file JSON standard
      logger.info('Wallet non trovato, importazione dal file standard');
      
      const standardWalletPath = path.join(process.env.HOME, '.config', 'solana', 'id.json');
      
      if (!fs.existsSync(standardWalletPath)) {
        throw new Error(`Wallet standard non trovato: ${standardWalletPath}`);
      }
      
      walletInfo = walletManager.importWallet(
        CONFIG.WALLET_NAME,
        CONFIG.WALLET_PASSWORD,
        standardWalletPath
      );
    }
    
    logger.info(`Wallet attivo: ${walletInfo.publicKey}`);
    
    // Crea un checkpoint dopo l'inizializzazione del wallet
    recoveryManager.createCheckpoint('wallet_initialized', {
      timestamp: Date.now(),
      walletInfo: {
        name: walletInfo.name,
        publicKey: walletInfo.publicKey
      }
    });
    
    // Verifica il saldo del wallet
    const wallet = walletManager.loadWallet(CONFIG.WALLET_NAME, CONFIG.WALLET_PASSWORD);
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`Saldo del wallet: ${balance / 1000000000} SOL`);
    
    if (balance < 10000000) { // 0.01 SOL
      logger.warn('Saldo del wallet basso, potrebbe non essere sufficiente per il deploy');
    }
    
    // Inizializza il Bundle Engine
    logger.info('Inizializzazione del Bundle Engine');
    const bundleEngine = new ScalableBundleEngine(
      connection,
      new PublicKey(CONFIG.TOKEN_ADDRESS),
      {
        walletManager,
        walletName: CONFIG.WALLET_NAME,
        walletPassword: CONFIG.WALLET_PASSWORD,
        autoScaling: { ENABLED: true },
        sharding: { ENABLED: true },
        caching: { ENABLED: true },
        throttling: { ENABLED: true }
      }
    );
    
    // Crea un checkpoint dopo l'inizializzazione del Bundle Engine
    recoveryManager.createCheckpoint('bundle_engine_initialized', {
      timestamp: Date.now(),
      bundleEngineStats: bundleEngine.getStats()
    });
    
    // Esegui una transazione di test
    logger.info('Esecuzione di una transazione di test');
    try {
      // Crea un keypair di test
      const testKeypair = Keypair.generate();
      
      // Aggiungi una transazione di test
      await bundleEngine.addTransaction(
        wallet, // fromKeypair
        testKeypair.publicKey, // toWallet
        1, // amount (minimo)
        '127.0.0.1' // IP (per il throttling)
      );
      
      logger.info('Transazione di test aggiunta con successo');
    } catch (error) {
      logger.warn(`Errore durante l'aggiunta della transazione di test: ${error.message}`);
      // Non bloccare il deploy per un errore nella transazione di test
    }
    
    // Crea un checkpoint finale
    const finalCheckpoint = recoveryManager.createCheckpoint('deploy_complete', {
      timestamp: Date.now(),
      status: 'success',
      message: 'Deploy completato con successo'
    });
    
    logger.info(`Deploy completato con successo. Checkpoint finale: ${finalCheckpoint.id}`);
    
    // Chiudi i componenti
    bundleEngine.close();
    recoveryManager.close();
    
    return {
      success: true,
      walletPublicKey: walletInfo.publicKey,
      timestamp: Date.now(),
      message: 'Deploy completato con successo'
    };
  } catch (error) {
    logger.error(`Errore durante il deploy: ${error.message}`, { error });
    
    return {
      success: false,
      error: error.message,
      timestamp: Date.now(),
      message: 'Deploy fallito'
    };
  }
}

// Funzione per assicurarsi che le directory necessarie esistano
function ensureDirectoriesExist() {
  const directories = [
    CONFIG.WALLET_DIR,
    CONFIG.LOG_DIR,
    CONFIG.CHECKPOINT_DIR
  ];
  
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Directory creata: ${dir}`);
    }
  }
}

// Esegui il deploy
if (require.main === module) {
  deploy()
    .then(result => {
      if (result.success) {
        logger.info('Deploy completato con successo');
        process.exit(0);
      } else {
        logger.error(`Deploy fallito: ${result.error}`);
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error(`Errore non gestito: ${error.message}`, { error });
      process.exit(1);
    });
}

module.exports = { deploy };
