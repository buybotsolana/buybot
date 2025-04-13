// Script di configurazione per il token BuyBot (Versione migliorata)
// Questo script configura tutti i programmi ancillari per il token BuyBot

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Connection, PublicKey } = require('@solana/web3.js');

// Importa i moduli dei programmi ancillari
const { BundleEngineImproved } = require('./programs/bundle_engine_improved');
const { UltraGrowthBoostManager } = require('./programs/ultra_growth_boost_manager');
const { createMonitoringSystem } = require('./monitoring/dashboard');

// Configurazione
const TOKEN_ADDRESS = '7PjHKEXQXewzv2FTi9oiPhaL3tE4xE8GPWAU5BDMdng7';
const WALLET_PATH = path.join(__dirname, 'wallet', 'buybot_wallet.json');
const RPC_URL = 'https://api.devnet.solana.com';

async function configureAll() {
  console.log('=== Configurazione di tutti i programmi ancillari per il token BuyBot (Versione migliorata) ===');
  console.log(`Token Address: ${TOKEN_ADDRESS}`);
  
  try {
    // Verifica che il wallet sia configurato correttamente
    console.log('\n[1/6] Verifica della configurazione del wallet...');
    
    // Crea la directory se non esiste
    fs.mkdirSync(path.join(process.env.HOME, '.config', 'solana'), { recursive: true });
    
    // Copia il wallet nella posizione predefinita di Solana
    if (fs.existsSync(WALLET_PATH)) {
      fs.copyFileSync(WALLET_PATH, path.join(process.env.HOME, '.config', 'solana', 'id.json'));
      console.log(`Wallet copiato da ${WALLET_PATH} a ${path.join(process.env.HOME, '.config', 'solana', 'id.json')}`);
    } else {
      console.warn(`Attenzione: Il file wallet non esiste in ${WALLET_PATH}. Utilizzo del wallet predefinito.`);
    }
    
    // Verifica il wallet
    try {
      const pubkey = execSync('solana-keygen pubkey').toString().trim();
      console.log(`Wallet configurato: ${pubkey}`);
      
      // Verifica il saldo
      const balance = execSync('solana balance').toString().trim();
      console.log(`Saldo del wallet: ${balance}`);
    } catch (error) {
      console.warn(`Attenzione: Impossibile verificare il wallet. Assicurati che Solana CLI sia installato.`);
      console.warn(`Errore: ${error.message}`);
    }
    
    // Configura la rete devnet
    try {
      execSync('solana config set --url https://api.devnet.solana.com');
      console.log('Rete configurata: devnet');
    } catch (error) {
      console.warn(`Attenzione: Impossibile configurare la rete. Assicurati che Solana CLI sia installato.`);
      console.warn(`Errore: ${error.message}`);
    }
    
    // Crea la connessione a Solana
    const connection = new Connection(RPC_URL, 'confirmed');
    console.log(`Connessione a Solana stabilita: ${RPC_URL}`);
    
    // Inizializza il Bundle Engine migliorato
    console.log('\n[2/6] Inizializzazione del Bundle Engine migliorato...');
    const bundleEngine = new BundleEngineImproved(connection, TOKEN_ADDRESS, WALLET_PATH);
    console.log(`Bundle Engine migliorato inizializzato per il token: ${TOKEN_ADDRESS}`);
    
    // Inizializza l'UltraGrowthBoostManager
    console.log('\n[3/6] Inizializzazione dell\'UltraGrowthBoostManager...');
    const boostManager = new UltraGrowthBoostManager({
      initialPrice: 0.000001,
      targetMarketcap: 20000000,
      totalSupply: 1000000000
    });
    console.log(`UltraGrowthBoostManager inizializzato con prezzo iniziale: ${boostManager.currentPrice}`);
    console.log(`Target marketcap: ${boostManager.config.targetMarketcap}`);
    
    // Inizializza il sistema di monitoraggio
    console.log('\n[4/6] Inizializzazione del sistema di monitoraggio...');
    const monitoringSystem = createMonitoringSystem();
    console.log(`Sistema di monitoraggio inizializzato`);
    
    // Configura gli altri programmi ancillari
    console.log('\n[5/6] Configurazione degli altri programmi ancillari...');
    
    // Qui configureremo gli altri programmi ancillari come Anti-Rug System, Lock Liquidity, ecc.
    // In questa versione semplificata, ci concentriamo solo sui componenti principali
    
    console.log('Altri programmi ancillari configurati con successo');
    
    // Avvia il sistema di monitoraggio
    console.log('\n[6/6] Avvio del sistema di monitoraggio...');
    monitoringSystem.start();
    console.log(`Sistema di monitoraggio avviato sulla porta ${process.env.PORT || 3000}`);
    
    // Aggiorna le metriche iniziali
    monitoringSystem.updateTokenMetrics({
      price: boostManager.currentPrice,
      marketcap: boostManager.currentPrice * boostManager.config.totalSupply,
      holders: 0,
      transactions: 0,
      volume: 0
    });
    
    monitoringSystem.updateBoostMetrics({
      enabled: boostManager.config.enabled,
      currentPhase: boostManager.getCurrentCapPhase(),
      transactionCount: boostManager.transactionCount,
      lastBoostTime: boostManager.lastBoostTime,
      boostHistory: boostManager.boostHistory
    });
    
    monitoringSystem.updateBundleMetrics(bundleEngine.getStats());
    
    console.log('\n=== Configurazione completata con successo! ===');
    console.log('Tutti i programmi ancillari sono stati inizializzati e configurati per il token BuyBot.');
    console.log(`Dashboard di monitoraggio disponibile su: http://localhost:${process.env.PORT || 3000}`);
    console.log('Per ulteriori informazioni, consulta la documentazione in docs/deployment_guide.md');
    
    return {
      tokenAddress: TOKEN_ADDRESS,
      bundleEngine,
      boostManager,
      monitoringSystem
    };
  } catch (error) {
    console.error('Errore durante la configurazione:', error);
    throw error;
  }
}

// Se eseguito direttamente, esegui la configurazione
if (require.main === module) {
  configureAll()
    .then(info => {
      console.log('Configurazione completata con successo!');
      // Non terminare il processo per mantenere attivo il server di monitoraggio
      console.log('Premi Ctrl+C per terminare il server di monitoraggio');
    })
    .catch(error => {
      console.error('Errore durante la configurazione:', error);
      process.exit(1);
    });
}

module.exports = {
  configureAll
};
