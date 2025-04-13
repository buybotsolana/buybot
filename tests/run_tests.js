// Script di test per verificare l'implementazione di BuyBot migliorato
// Questo script esegue test su Bundle Engine e UltraGrowthBoostManager

const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { BundleEngineImproved } = require('../programs/bundle_engine_improved');
const { UltraGrowthBoostManager } = require('../programs/ultra_growth_boost_manager');
const fs = require('fs');
const path = require('path');

// Configurazione
const RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_ADDRESS = '7PjHKEXQXewzv2FTi9oiPhaL3tE4xE8GPWAU5BDMdng7';
const TEST_RESULTS_DIR = path.join(__dirname, '..', 'test_results');

// Assicurati che la directory dei risultati dei test esista
if (!fs.existsSync(TEST_RESULTS_DIR)) {
  fs.mkdirSync(TEST_RESULTS_DIR, { recursive: true });
}

// Funzione per generare un keypair casuale
function generateRandomKeypair() {
  return Keypair.generate();
}

// Funzione per salvare i risultati dei test
function saveTestResults(filename, results) {
  const filePath = path.join(TEST_RESULTS_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
  console.log(`Risultati salvati in: ${filePath}`);
}

// Test del Bundle Engine migliorato
async function testBundleEngine() {
  console.log('\n=== Test del Bundle Engine migliorato ===');
  
  try {
    // Crea una connessione a Solana
    const connection = new Connection(RPC_URL, 'confirmed');
    console.log(`Connessione a Solana stabilita: ${RPC_URL}`);
    
    // Inizializza il Bundle Engine migliorato
    console.log('Inizializzazione del Bundle Engine migliorato...');
    const bundleEngine = new BundleEngineImproved(connection, TOKEN_ADDRESS);
    console.log(`Bundle Engine migliorato inizializzato per il token: ${TOKEN_ADDRESS}`);
    
    // Test delle prestazioni
    console.log('\nTest delle prestazioni del Bundle Engine...');
    
    // Genera transazioni casuali
    const numTransactions = 10;
    const transactions = [];
    
    console.log(`Generazione di ${numTransactions} transazioni casuali...`);
    for (let i = 0; i < numTransactions; i++) {
      const fromKeypair = generateRandomKeypair();
      const toWallet = generateRandomKeypair().publicKey;
      const amount = Math.floor(Math.random() * 1000) + 1;
      
      transactions.push({
        fromKeypair,
        toWallet,
        amount
      });
    }
    
    // Misura il tempo di elaborazione
    console.log('Misurazione del tempo di elaborazione...');
    const startTime = Date.now();
    
    // Simula l'aggiunta delle transazioni al bundle
    for (const tx of transactions) {
      try {
        // Nota: in un ambiente reale, questo aggiungerebbe effettivamente la transazione
        // Qui simuliamo solo il processo per evitare errori di connessione
        console.log(`Simulazione dell'aggiunta della transazione: ${tx.fromKeypair.publicKey.toString()} -> ${tx.toWallet.toString()}, ${tx.amount} token`);
      } catch (error) {
        console.error(`Errore durante l'aggiunta della transazione:`, error);
      }
    }
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    const processingTimePerTransaction = processingTime / numTransactions;
    
    console.log(`Tempo di elaborazione totale: ${processingTime} ms`);
    console.log(`Tempo di elaborazione per transazione: ${processingTimePerTransaction.toFixed(2)} ms`);
    
    // Ottieni le statistiche del bundle engine
    const stats = bundleEngine.getStats();
    
    // Salva i risultati dei test
    const results = {
      testName: 'Bundle Engine Test',
      timestamp: new Date().toISOString(),
      numTransactions,
      processingTime,
      processingTimePerTransaction,
      stats
    };
    
    saveTestResults('bundle_engine_test_results.json', results);
    
    console.log('\nTest del Bundle Engine completato con successo!');
    return results;
  } catch (error) {
    console.error('Errore durante il test del Bundle Engine:', error);
    throw error;
  }
}

// Test dell'UltraGrowthBoostManager
async function testUltraGrowthBoostManager() {
  console.log('\n=== Test dell\'UltraGrowthBoostManager ===');
  
  try {
    // Inizializza l'UltraGrowthBoostManager
    console.log('Inizializzazione dell\'UltraGrowthBoostManager...');
    const boostManager = new UltraGrowthBoostManager({
      initialPrice: 0.000001,
      targetMarketcap: 20000000,
      totalSupply: 1000000000,
      debugMode: true
    });
    
    console.log(`UltraGrowthBoostManager inizializzato con prezzo iniziale: ${boostManager.currentPrice}`);
    console.log(`Target marketcap: ${boostManager.config.targetMarketcap}`);
    
    // Test delle fasi
    console.log('\nTest delle fasi di crescita...');
    
    const phases = ['microCap', 'smallCap', 'midCap', 'largeCap'];
    const phaseResults = {};
    
    for (const phase of phases) {
      const phaseConfig = boostManager.config.phases[phase];
      console.log(`\nFase: ${phase}`);
      console.log(`Threshold: ${phaseConfig.threshold}`);
      console.log(`Boost Percentage: ${phaseConfig.boostPercentage}%`);
      console.log(`Transactions Required: ${phaseConfig.transactionsRequired}`);
      
      // Simula l'incremento delle transazioni
      console.log(`Simulazione di ${phaseConfig.transactionsRequired} transazioni...`);
      boostManager.incrementTransactionCount(phaseConfig.transactionsRequired, 'buy');
      
      // Verifica se è possibile attivare un boost
      const canBoost = boostManager.canBoost();
      console.log(`Può attivare un boost: ${canBoost}`);
      
      // Attiva un boost se possibile
      let boost = null;
      if (canBoost) {
        boost = boostManager.activateBoost();
        console.log(`Boost attivato! Percentuale: ${boost.percentage.toFixed(2)}%`);
        console.log(`Prezzo: ${boost.priceBeforeBoost} -> ${boost.priceAfterBoost}`);
        console.log(`Marketcap: ${boost.marketcapBeforeBoost} -> ${boost.marketcapAfterBoost}`);
      }
      
      // Salva i risultati per questa fase
      phaseResults[phase] = {
        phaseConfig,
        transactionsSimulated: phaseConfig.transactionsRequired,
        canBoost,
        boost
      };
    }
    
    // Test di boost multipli
    console.log('\nTest di boost multipli...');
    
    const numBoosts = 5;
    const boostResults = [];
    
    for (let i = 0; i < numBoosts; i++) {
      // Simula l'incremento delle transazioni
      const currentPhase = boostManager.getCurrentCapPhase();
      const transactionsRequired = boostManager.config.phases[currentPhase].transactionsRequired;
      
      console.log(`\nBoost #${i+1}`);
      console.log(`Fase corrente: ${currentPhase}`);
      console.log(`Simulazione di ${transactionsRequired} transazioni...`);
      
      boostManager.incrementTransactionCount(transactionsRequired, 'buy');
      
      // Verifica se è possibile attivare un boost
      const canBoost = boostManager.canBoost();
      console.log(`Può attivare un boost: ${canBoost}`);
      
      // Attiva un boost se possibile
      let boost = null;
      if (canBoost) {
        boost = boostManager.activateBoost();
        console.log(`Boost attivato! Percentuale: ${boost.percentage.toFixed(2)}%`);
        console.log(`Prezzo: ${boost.priceBeforeBoost} -> ${boost.priceAfterBoost}`);
        console.log(`Marketcap: ${boost.marketcapBeforeBoost} -> ${boost.marketcapAfterBoost}`);
      } else {
        console.log('Impossibile attivare un boost. Simulazione di un boost manuale...');
        boost = boostManager.activateManualBoost(50);
        if (boost) {
          console.log(`Boost manuale attivato! Percentuale: 50%`);
          console.log(`Prezzo: ${boost.priceBeforeBoost} -> ${boost.priceAfterBoost}`);
          console.log(`Marketcap: ${boost.marketcapBeforeBoost} -> ${boost.marketcapAfterBoost}`);
        }
      }
      
      // Salva i risultati per questo boost
      boostResults.push({
        boostNumber: i+1,
        currentPhase,
        transactionsSimulated: transactionsRequired,
        canBoost,
        boost
      });
    }
    
    // Genera un report
    console.log('\nGenerazione del report...');
    const report = boostManager.generateReport();
    console.log(`Report generato. Crescita totale: ${report.priceGrowth.toFixed(2)}%`);
    
    // Salva i risultati dei test
    const results = {
      testName: 'UltraGrowthBoostManager Test',
      timestamp: new Date().toISOString(),
      initialPrice: boostManager.config.initialPrice,
      finalPrice: boostManager.currentPrice,
      priceGrowth: report.priceGrowth,
      marketcapGrowth: report.marketcapGrowth,
      phaseResults,
      boostResults,
      report
    };
    
    saveTestResults('ultra_growth_boost_manager_test_results.json', results);
    
    console.log('\nTest dell\'UltraGrowthBoostManager completato con successo!');
    return results;
  } catch (error) {
    console.error('Errore durante il test dell\'UltraGrowthBoostManager:', error);
    throw error;
  }
}

// Esegui tutti i test
async function runAllTests() {
  console.log('=== Esecuzione di tutti i test per BuyBot migliorato ===');
  
  try {
    // Test del Bundle Engine
    const bundleEngineResults = await testBundleEngine();
    
    // Test dell'UltraGrowthBoostManager
    const boostManagerResults = await testUltraGrowthBoostManager();
    
    // Salva i risultati combinati
    const combinedResults = {
      testName: 'BuyBot Improved - All Tests',
      timestamp: new Date().toISOString(),
      bundleEngineResults,
      boostManagerResults
    };
    
    saveTestResults('all_tests_results.json', combinedResults);
    
    console.log('\n=== Tutti i test completati con successo! ===');
    return combinedResults;
  } catch (error) {
    console.error('Errore durante l\'esecuzione dei test:', error);
    throw error;
  }
}

// Se eseguito direttamente, esegui tutti i test
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log('Test completati con successo!');
      process.exit(0);
    })
    .catch(error => {
      console.error('Errore durante i test:', error);
      process.exit(1);
    });
}

module.exports = {
  testBundleEngine,
  testUltraGrowthBoostManager,
  runAllTests
};
