// Test unitari per il sistema di sicurezza e scalabilità
// Questo file contiene test completi per verificare le correzioni implementate

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const { Token } = require('@solana/spl-token');

// Importa i moduli da testare
const SecureWalletManager = require('../wallet/secure_wallet_manager');
const ReentrancyGuard = require('../programs/reentrancy_guard');
const SignatureVerifier = require('../programs/signature_verifier');
const { ScalableBundleEngine, SafeMath, CacheManager, ThrottlingManager, ShardManager, AutoScalingManager } = require('../programs/scalable_bundle_engine');
const { ErrorHandler, RecoveryManager } = require('../programs/recovery_system');

// Directory temporanea per i test
const TEST_DIR = path.join(__dirname, 'test_temp');
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Funzione di utilità per creare un keypair di test
function createTestKeypair() {
  return Keypair.generate();
}

// Funzione di utilità per creare un file di wallet di test
function createTestWalletFile(keypair) {
  const walletPath = path.join(TEST_DIR, 'test_wallet.json');
  fs.writeFileSync(walletPath, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  return walletPath;
}

// Funzione di utilità per pulire i file di test
function cleanupTestFiles() {
  if (fs.existsSync(TEST_DIR)) {
    const files = fs.readdirSync(TEST_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_DIR, file));
    }
    fs.rmdirSync(TEST_DIR);
  }
}

// Test suite principale
async function runTests() {
  console.log('=== Inizio dei test ===');
  let testsPassed = 0;
  let testsFailed = 0;
  
  try {
    // Test per SecureWalletManager
    console.log('\n--- Test di SecureWalletManager ---');
    await testSecureWalletManager();
    testsPassed++;
    
    // Test per ReentrancyGuard
    console.log('\n--- Test di ReentrancyGuard ---');
    await testReentrancyGuard();
    testsPassed++;
    
    // Test per SignatureVerifier
    console.log('\n--- Test di SignatureVerifier ---');
    await testSignatureVerifier();
    testsPassed++;
    
    // Test per SafeMath
    console.log('\n--- Test di SafeMath ---');
    testSafeMath();
    testsPassed++;
    
    // Test per CacheManager
    console.log('\n--- Test di CacheManager ---');
    testCacheManager();
    testsPassed++;
    
    // Test per ThrottlingManager
    console.log('\n--- Test di ThrottlingManager ---');
    testThrottlingManager();
    testsPassed++;
    
    // Test per ShardManager
    console.log('\n--- Test di ShardManager ---');
    testShardManager();
    testsPassed++;
    
    // Test per ErrorHandler
    console.log('\n--- Test di ErrorHandler ---');
    testErrorHandler();
    testsPassed++;
    
    // Test per RecoveryManager
    console.log('\n--- Test di RecoveryManager ---');
    await testRecoveryManager();
    testsPassed++;
    
    // Test di integrazione
    console.log('\n--- Test di integrazione ---');
    await testIntegration();
    testsPassed++;
    
  } catch (error) {
    console.error('Test fallito:', error);
    testsFailed++;
  } finally {
    // Pulisci i file di test
    cleanupTestFiles();
  }
  
  console.log(`\n=== Fine dei test ===`);
  console.log(`Test passati: ${testsPassed}`);
  console.log(`Test falliti: ${testsFailed}`);
  
  return {
    passed: testsPassed,
    failed: testsFailed,
    total: testsPassed + testsFailed
  };
}

// Test per SecureWalletManager
async function testSecureWalletManager() {
  // Crea una directory temporanea per i wallet
  const walletDir = path.join(TEST_DIR, 'secure_wallets');
  if (!fs.existsSync(walletDir)) {
    fs.mkdirSync(walletDir, { recursive: true });
  }
  
  // Crea un'istanza di SecureWalletManager
  const walletManager = new SecureWalletManager(walletDir);
  
  // Test: generazione di un nuovo wallet
  console.log('Test: generazione di un nuovo wallet');
  const walletName = 'test_wallet';
  const password = 'test_password';
  const walletInfo = walletManager.generateWallet(walletName, password);
  
  assert(walletInfo.name === walletName, 'Il nome del wallet non corrisponde');
  assert(walletInfo.publicKey, 'La chiave pubblica non è stata generata');
  assert(fs.existsSync(walletInfo.path), 'Il file del wallet non è stato creato');
  
  // Test: caricamento di un wallet
  console.log('Test: caricamento di un wallet');
  const loadedWallet = walletManager.loadWallet(walletName, password);
  
  assert(loadedWallet.publicKey.toString() === walletInfo.publicKey, 'La chiave pubblica non corrisponde');
  
  // Test: cambio password
  console.log('Test: cambio password');
  const newPassword = 'new_password';
  const passwordChanged = walletManager.changePassword(walletName, password, newPassword);
  
  assert(passwordChanged, 'Cambio password fallito');
  
  // Test: caricamento con la nuova password
  console.log('Test: caricamento con la nuova password');
  const reloadedWallet = walletManager.loadWallet(walletName, newPassword);
  
  assert(reloadedWallet.publicKey.toString() === walletInfo.publicKey, 'La chiave pubblica non corrisponde dopo il cambio password');
  
  // Test: importazione di un wallet esistente
  console.log('Test: importazione di un wallet esistente');
  const testKeypair = createTestKeypair();
  const testWalletPath = createTestWalletFile(testKeypair);
  
  const importedWalletInfo = walletManager.importWallet('imported_wallet', 'import_password', testWalletPath);
  
  assert(importedWalletInfo.name === 'imported_wallet', 'Il nome del wallet importato non corrisponde');
  assert(importedWalletInfo.publicKey === testKeypair.publicKey.toString(), 'La chiave pubblica del wallet importato non corrisponde');
  
  // Test: elenco dei wallet
  console.log('Test: elenco dei wallet');
  const wallets = walletManager.listWallets();
  
  assert(wallets.length === 2, 'Il numero di wallet non corrisponde');
  assert(wallets.some(w => w.name === walletName), 'Il wallet generato non è presente nell\'elenco');
  assert(wallets.some(w => w.name === 'imported_wallet'), 'Il wallet importato non è presente nell\'elenco');
  
  // Test: eliminazione di un wallet
  console.log('Test: eliminazione di un wallet');
  const deleted = walletManager.deleteWallet('imported_wallet', 'import_password');
  
  assert(deleted, 'Eliminazione del wallet fallita');
  
  const walletsAfterDelete = walletManager.listWallets();
  assert(walletsAfterDelete.length === 1, 'Il numero di wallet dopo l\'eliminazione non corrisponde');
  assert(!walletsAfterDelete.some(w => w.name === 'imported_wallet'), 'Il wallet eliminato è ancora presente nell\'elenco');
  
  console.log('Tutti i test di SecureWalletManager sono passati!');
}

// Test per ReentrancyGuard
async function testReentrancyGuard() {
  // Crea un'istanza di ReentrancyGuard
  const guard = new ReentrancyGuard();
  
  // Test: esecuzione di una funzione con protezione
  console.log('Test: esecuzione di una funzione con protezione');
  let counter = 0;
  
  const result = await guard.executeWithGuard(
    'test_operation',
    async () => {
      counter++;
      return 'success';
    }
  );
  
  assert(result === 'success', 'Il risultato non corrisponde');
  assert(counter === 1, 'La funzione non è stata eseguita correttamente');
  
  // Test: protezione contro reentrancy
  console.log('Test: protezione contro reentrancy');
  let reentrancyDetected = false;
  
  // Simula un tentativo di reentrancy
  const reentrancyTest = async () => {
    await guard.executeWithGuard(
      'reentrancy_test',
      async () => {
        // Tenta di eseguire la stessa operazione mentre è già in corso
        try {
          await guard.executeWithGuard(
            'reentrancy_test',
            async () => {
              return 'inner_call';
            }
          );
        } catch (error) {
          reentrancyDetected = true;
          throw error;
        }
        
        return 'outer_call';
      }
    );
  };
  
  try {
    await reentrancyTest();
  } catch (error) {
    // Ci aspettiamo un errore
  }
  
  assert(reentrancyDetected, 'La protezione contro reentrancy non ha funzionato');
  
  // Test: operazioni in coda
  console.log('Test: operazioni in coda');
  const operationResults = [];
  
  // Esegui più operazioni in parallelo
  await Promise.all([
    guard.executeWithGuard(
      'queue_test',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        operationResults.push(1);
        return 1;
      }
    ),
    guard.executeWithGuard(
      'queue_test',
      async () => {
        operationResults.push(2);
        return 2;
      }
    ),
    guard.executeWithGuard(
      'queue_test',
      async () => {
        operationResults.push(3);
        return 3;
      }
    )
  ]);
  
  assert(operationResults.length === 3, 'Non tutte le operazioni sono state eseguite');
  assert(operationResults[0] === 1, 'La prima operazione non è stata eseguita per prima');
  
  // Test: operazioni diverse possono essere eseguite in parallelo
  console.log('Test: operazioni diverse in parallelo');
  const parallelResults = [];
  
  await Promise.all([
    guard.executeWithGuard(
      'parallel_test_1',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        parallelResults.push(1);
        return 1;
      }
    ),
    guard.executeWithGuard(
      'parallel_test_2',
      async () => {
        parallelResults.push(2);
        return 2;
      }
    )
  ]);
  
  assert(parallelResults.length === 2, 'Non tutte le operazioni parallele sono state eseguite');
  
  console.log('Tutti i test di ReentrancyGuard sono passati!');
}

// Test per SignatureVerifier
async function testSignatureVerifier() {
  // Crea un'istanza di SignatureVerifier
  const verifier = new SignatureVerifier();
  
  // Test: verifica di una firma valida
  console.log('Test: verifica di una firma valida');
  const keypair = createTestKeypair();
  const message = Buffer.from('test message');
  const signature = crypto.sign(null, message, keypair.secretKey);
  
  const isValid = verifier.verifySignature(
    message,
    signature,
    keypair.publicKey
  );
  
  assert(isValid, 'La verifica della firma valida è fallita');
  
  // Test: verifica di una firma non valida
  console.log('Test: verifica di una firma non valida');
  const wrongKeypair = createTestKeypair();
  const wrongSignature = crypto.sign(null, message, wrongKeypair.secretKey);
  
  const isInvalid = verifier.verifySignature(
    message,
    wrongSignature,
    keypair.publicKey
  );
  
  assert(!isInvalid, 'La verifica della firma non valida è passata erroneamente');
  
  // Test: cache delle verifiche
  console.log('Test: cache delle verifiche');
  
  // Prima verifica (dovrebbe calcolare)
  const firstVerification = verifier.verifySignature(
    message,
    signature,
    keypair.publicKey
  );
  
  // Seconda verifica (dovrebbe usare la cache)
  const secondVerification = verifier.verifySignature(
    message,
    signature,
    keypair.publicKey
  );
  
  assert(firstVerification === secondVerification, 'I risultati delle verifiche non corrispondono');
  
  console.log('Tutti i test di SignatureVerifier sono passati!');
}

// Test per SafeMath
function testSafeMath() {
  // Test: addizione sicura
  console.log('Test: addizione sicura');
  assert(SafeMath.add(5, 3) === 8, 'Addizione semplice fallita');
  assert(SafeMath.add(Number.MAX_SAFE_INTEGER, 1) === Number.MAX_SAFE_INTEGER, 'Protezione da overflow fallita');
  
  // Test: sottrazione sicura
  console.log('Test: sottrazione sicura');
  assert(SafeMath.subtract(5, 3) === 2, 'Sottrazione semplice fallita');
  assert(SafeMath.subtract(3, 5) === 0, 'Protezione da underflow fallita');
  
  // Test: moltiplicazione sicura
  console.log('Test: moltiplicazione sicura');
  assert(SafeMath.multiply(5, 3) === 15, 'Moltiplicazione semplice fallita');
  assert(SafeMath.multiply(Number.MAX_SAFE_INTEGER, 2) === Number.MAX_SAFE_INTEGER, 'Protezione da overflow fallita');
  
  // Test: divisione sicura
  console.log('Test: divisione sicura');
  assert(SafeMath.divide(6, 3) === 2, 'Divisione semplice fallita');
  assert(SafeMath.divide(5, 0) === 0, 'Protezione da divisione per zero fallita');
  
  // Test: clamp
  console.log('Test: clamp');
  assert(SafeMath.clamp(5, 1, 10) === 5, 'Clamp in range fallito');
  assert(SafeMath.clamp(0, 1, 10) === 1, 'Clamp sotto il minimo fallito');
  assert(SafeMath.clamp(11, 1, 10) === 10, 'Clamp sopra il massimo fallito');
  
  // Test: percentuale
  console.log('Test: percentuale');
  assert(SafeMath.percentage(100, 10) === 10, 'Calcolo percentuale fallito');
  
  console.log('Tutti i test di SafeMath sono passati!');
}

// Test per CacheManager
function testCacheManager() {
  // Crea un'istanza di CacheManager
  const cache = new CacheManager({
    TTL: 100, // 100ms per i test
    MAX_SIZE: 3,
    PRUNE_INTERVAL: 50 // 50ms per i test
  });
  
  // Test: set e get
  console.log('Test: set e get');
  cache.set('key1', 'value1');
  assert(cache.get('key1') === 'value1', 'Get dopo set fallito');
  
  // Test: TTL
  console.log('Test: TTL');
  cache.set('key2', 'value2', 50); // TTL di 50ms
  
  assert(cache.get('key2') === 'value2', 'Get immediato fallito');
  
  setTimeout(() => {
    assert(cache.get('key2') === null, 'TTL non rispettato');
  }, 60);
  
  // Test: dimensione massima
  console.log('Test: dimensione massima');
  cache.set('key3', 'value3');
  cache.set('key4', 'value4');
  cache.set('key5', 'value5');
  
  // La cache dovrebbe contenere solo le ultime 3 chiavi
  assert(cache.get('key1') === null, 'Limite dimensione cache non rispettato');
  assert(cache.get('key3') === 'value3', 'Chiave 3 mancante');
  assert(cache.get('key4') === 'value4', 'Chiave 4 mancante');
  assert(cache.get('key5') === 'value5', 'Chiave 5 mancante');
  
  // Test: delete
  console.log('Test: delete');
  cache.delete('key4');
  assert(cache.get('key4') === null, 'Delete fallito');
  
  // Test: statistiche
  console.log('Test: statistiche');
  const stats = cache.getStats();
  
  assert(stats.size <= 3, 'Dimensione cache non corretta');
  assert(stats.maxSize === 3, 'Dimensione massima cache non corretta');
  
  console.log('Tutti i test di CacheManager sono passati!');
}

// Test per ThrottlingManager
function testThrottlingManager() {
  // Crea un'istanza di ThrottlingManager
  const throttling = new ThrottlingManager({
    MAX_REQUESTS_PER_SECOND: 5,
    MAX_REQUESTS_PER_IP: 3,
    WINDOW_MS: 100, // 100ms per i test
    BLOCK_DURATION: 200 // 200ms per i test
  });
  
  // Test: richieste consentite
  console.log('Test: richieste consentite');
  assert(throttling.isAllowed('127.0.0.1'), 'Prima richiesta non consentita');
  throttling.recordRequest('127.0.0.1');
  
  assert(throttling.isAllowed('127.0.0.1'), 'Seconda richiesta non consentita');
  throttling.recordRequest('127.0.0.1');
  
  assert(throttling.isAllowed('127.0.0.1'), 'Terza richiesta non consentita');
  throttling.recordRequest('127.0.0.1');
  
  // Test: limite per IP
  console.log('Test: limite per IP');
  assert(!throttling.isAllowed('127.0.0.1'), 'Quarta richiesta consentita nonostante il limite');
  
  // Test: IP diversi
  console.log('Test: IP diversi');
  assert(throttling.isAllowed('127.0.0.2'), 'Richiesta da IP diverso non consentita');
  
  // Test: limite globale
  console.log('Test: limite globale');
  for (let i = 0; i < 5; i++) {
    throttling.recordRequest(`192.168.1.${i}`);
  }
  
  assert(!throttling.isAllowed('192.168.1.10'), 'Richiesta consentita nonostante il limite globale');
  
  // Test: reset dopo il timeout
  console.log('Test: reset dopo il timeout');
  setTimeout(() => {
    assert(throttling.isAllowed('127.0.0.1'), 'Richiesta non consentita dopo il timeout');
    
    // Cleanup
    throttling.cleanup();
    
    console.log('Tutti i test di ThrottlingManager sono passati!');
  }, 250);
}

// Test per ShardManager
function testShardManager() {
  // Crea un'istanza di ShardManager
  const shardManager = new ShardManager({
    SHARD_COUNT: 3,
    SHARD_BY: 'sender',
    REBALANCE_INTERVAL: 100 // 100ms per i test
  });
  
  // Crea alcune transazioni di test
  const transactions = [
    { id: '1', fromWallet: new PublicKey('11111111111111111111111111111111'), toWallet: new PublicKey('22222222222222222222222222222222'), amount: 100 },
    { id: '2', fromWallet: new PublicKey('11111111111111111111111111111111'), toWallet: new PublicKey('33333333333333333333333333333333'), amount: 200 },
    { id: '3', fromWallet: new PublicKey('44444444444444444444444444444444'), toWallet: new PublicKey('55555555555555555555555555555555'), amount: 300 },
    { id: '4', fromWallet: new PublicKey('66666666666666666666666666666666'), toWallet: new PublicKey('77777777777777777777777777777777'), amount: 400 },
    { id: '5', fromWallet: new PublicKey('88888888888888888888888888888888'), toWallet: new PublicKey('99999999999999999999999999999999'), amount: 500 }
  ];
  
  // Test: assegnazione a shard
  console.log('Test: assegnazione a shard');
  const shardIndices = [];
  
  for (const tx of transactions) {
    const shardIndex = shardManager.assignToShard(tx);
    shardIndices.push(shardIndex);
    assert(shardIndex >= 0 && shardIndex < 3, `Indice shard non valido: ${shardIndex}`);
  }
  
  // Test: transazioni dallo stesso mittente vanno nello stesso shard
  console.log('Test: transazioni dallo stesso mittente nello stesso shard');
  assert(shardIndices[0] === shardIndices[1], 'Transazioni dallo stesso mittente in shard diversi');
  
  // Test: ottenere transazioni da uno shard
  console.log('Test: ottenere transazioni da uno shard');
  const shard0Transactions = shardManager.getTransactionsFromShard(0);
  const shard1Transactions = shardManager.getTransactionsFromShard(1);
  const shard2Transactions = shardManager.getTransactionsFromShard(2);
  
  assert(shard0Transactions.length + shard1Transactions.length + shard2Transactions.length === 5, 'Numero totale di transazioni non corretto');
  
  // Test: rimozione di transazioni da uno shard
  console.log('Test: rimozione di transazioni da uno shard');
  const shardToTest = shardIndices[0];
  const txIdsToRemove = ['1', '2'];
  
  const removedCount = shardManager.removeTransactionsFromShard(shardToTest, txIdsToRemove);
  assert(removedCount === 2, 'Numero di transazioni rimosse non corretto');
  
  // Test: ribilanciamento
  console.log('Test: ribilanciamento');
  
  // Aggiungi molte transazioni a uno shard per sbilanciarlo
  for (let i = 0; i < 10; i++) {
    shardManager.assignToShard({
      id: `extra_${i}`,
      fromWallet: new PublicKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      toWallet: new PublicKey('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
      amount: 1000 + i
    });
  }
  
  // Forza il ribilanciamento
  shardManager.rebalance();
  
  // Verifica le statistiche
  const stats = shardManager.getStats();
  assert(stats.shardCount === 3, 'Numero di shard non corretto');
  
  console.log('Tutti i test di ShardManager sono passati!');
}

// Test per ErrorHandler
function testErrorHandler() {
  // Crea una directory temporanea per i log
  const logDir = path.join(TEST_DIR, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Crea un'istanza di ErrorHandler
  const errorHandler = new ErrorHandler({
    logDir,
    notifyErrors: false,
    errorHandlers: {
      'test_error': (error, context) => {
        return {
          success: true,
          message: 'Errore di test gestito',
          handled: true
        };
      }
    },
    recoveryStrategies: {
      'test_recovery': (error, context) => {
        return {
          success: true,
          message: 'Recovery di test eseguito',
          recovered: true
        };
      }
    }
  });
  
  // Test: gestione di un errore
  console.log('Test: gestione di un errore');
  const error = new Error('Errore di test');
  const result = errorHandler.handleError('test_error', error, { test: true });
  
  assert(result.handled, 'Handler personalizzato non eseguito');
  
  // Test: gestione di un errore con recovery
  console.log('Test: gestione di un errore con recovery');
  errorHandler.registerRecoveryStrategy('test_recovery', (error, context) => {
    return {
      success: true,
      message: 'Recovery di test eseguito',
      recovered: true
    };
  });
  
  const recoveryResult = errorHandler.handleError('test_recovery', new Error('Errore di recovery'), { test: true });
  
  assert(recoveryResult.recovered, 'Strategia di recovery non eseguita');
  
  // Test: statistiche degli errori
  console.log('Test: statistiche degli errori');
  const stats = errorHandler.getErrorStats();
  
  assert(stats.totalErrors > 0, 'Conteggio errori non corretto');
  assert(stats.errorsByType['test_error'] > 0, 'Conteggio errori per tipo non corretto');
  
  console.log('Tutti i test di ErrorHandler sono passati!');
}

// Test per RecoveryManager
async function testRecoveryManager() {
  // Crea una directory temporanea per i checkpoint
  const checkpointDir = path.join(TEST_DIR, 'checkpoints');
  if (!fs.existsSync(checkpointDir)) {
    fs.mkdirSync(checkpointDir, { recursive: true });
  }
  
  // Crea un'istanza di ErrorHandler
  const errorHandler = new ErrorHandler({
    logDir: path.join(TEST_DIR, 'logs')
  });
  
  // Crea un'istanza di RecoveryManager
  const recoveryManager = new RecoveryManager({
    checkpointDir,
    checkpointInterval: 0, // Disabilita il checkpoint automatico per i test
    errorHandler
  });
  
  // Test: creazione di un checkpoint
  console.log('Test: creazione di un checkpoint');
  const checkpointData = {
    state: 'test_state',
    timestamp: Date.now(),
    transactions: [
      { id: '1', amount: 100 },
      { id: '2', amount: 200 }
    ]
  };
  
  const checkpoint = recoveryManager.createCheckpoint('test_checkpoint', checkpointData);
  
  assert(checkpoint.id.startsWith('test_checkpoint_'), 'ID checkpoint non corretto');
  assert(fs.existsSync(checkpoint.path), 'File checkpoint non creato');
  
  // Test: caricamento di un checkpoint
  console.log('Test: caricamento di un checkpoint');
  const loadedCheckpoint = recoveryManager.loadCheckpoint(checkpoint.id);
  
  assert(loadedCheckpoint.data.state === 'test_state', 'Stato checkpoint non corretto');
  assert(loadedCheckpoint.data.transactions.length === 2, 'Transazioni checkpoint non corrette');
  
  // Test: ripristino da un checkpoint
  console.log('Test: ripristino da un checkpoint');
  let restored = false;
  
  const restoreResult = await recoveryManager.restoreFromCheckpoint(
    checkpoint.id,
    (checkpoint) => {
      restored = true;
      return { restored: true, state: checkpoint.data.state };
    }
  );
  
  assert(restored, 'Funzione di ripristino non eseguita');
  assert(restoreResult.success, 'Ripristino non riuscito');
  
  // Test: elenco dei checkpoint
  console.log('Test: elenco dei checkpoint');
  const checkpoints = recoveryManager.listCheckpoints();
  
  assert(checkpoints.length > 0, 'Nessun checkpoint trovato');
  assert(checkpoints[0].id === checkpoint.id, 'ID checkpoint non corretto');
  
  // Test: eliminazione di un checkpoint
  console.log('Test: eliminazione di un checkpoint');
  const deleted = recoveryManager.deleteCheckpoint(checkpoint.id);
  
  assert(deleted, 'Eliminazione checkpoint fallita');
  assert(!fs.existsSync(checkpoint.path), 'File checkpoint non eliminato');
  
  // Chiudi il recovery manager
  recoveryManager.close();
  
  console.log('Tutti i test di RecoveryManager sono passati!');
}

// Test di integrazione
async function testIntegration() {
  console.log('Test: integrazione dei componenti');
  
  // Crea le directory temporanee
  const walletDir = path.join(TEST_DIR, 'integration_wallets');
  const logDir = path.join(TEST_DIR, 'integration_logs');
  const checkpointDir = path.join(TEST_DIR, 'integration_checkpoints');
  
  if (!fs.existsSync(walletDir)) fs.mkdirSync(walletDir, { recursive: true });
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(checkpointDir)) fs.mkdirSync(checkpointDir, { recursive: true });
  
  // Crea le istanze dei componenti
  const walletManager = new SecureWalletManager(walletDir);
  const reentrancyGuard = new ReentrancyGuard();
  const signatureVerifier = new SignatureVerifier();
  const errorHandler = new ErrorHandler({ logDir });
  const recoveryManager = new RecoveryManager({ checkpointDir, errorHandler });
  
  // Genera un wallet di test
  const walletInfo = walletManager.generateWallet('integration_wallet', 'integration_password');
  
  // Simula una connessione a Solana
  const connection = {
    rpcEndpoint: 'https://api.devnet.solana.com'
  };
  
  // Crea un'istanza di ScalableBundleEngine
  const bundleEngine = new ScalableBundleEngine(
    connection,
    '11111111111111111111111111111111', // Token address fittizio
    {
      walletManager,
      walletName: 'integration_wallet',
      walletPassword: 'integration_password'
    }
  );
  
  // Test: esecuzione di un'operazione con protezione contro reentrancy
  console.log('Test: operazione con protezione contro reentrancy');
  let operationResult = null;
  
  await reentrancyGuard.executeWithGuard(
    'integration_test',
    async () => {
      // Crea un checkpoint
      const checkpoint = recoveryManager.createCheckpoint('integration_test', {
        state: 'running',
        timestamp: Date.now()
      });
      
      // Simula un'operazione
      operationResult = 'success';
      
      // Aggiorna il checkpoint
      recoveryManager.createCheckpoint('integration_test_complete', {
        state: 'complete',
        timestamp: Date.now(),
        result: operationResult
      });
      
      return operationResult;
    }
  );
  
  assert(operationResult === 'success', 'Operazione non completata correttamente');
  
  // Test: gestione degli errori
  console.log('Test: gestione degli errori');
  try {
    throw new Error('Errore di integrazione');
  } catch (error) {
    const errorResult = errorHandler.handleError('integration_error', error, {
      component: 'integration_test'
    });
    
    assert(errorResult, 'Gestione errore fallita');
  }
  
  // Chiudi i componenti
  recoveryManager.close();
  
  console.log('Tutti i test di integrazione sono passati!');
}

// Esegui i test
runTests().then(results => {
  // Salva i risultati dei test
  const resultsPath = path.join(__dirname, 'test_results', 'security_scalability_tests.json');
  
  // Assicurati che la directory esista
  const resultsDir = path.dirname(resultsPath);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  
  console.log(`Risultati dei test salvati in: ${resultsPath}`);
  
  // Esci con codice appropriato
  process.exit(results.failed > 0 ? 1 : 0);
}).catch(error => {
  console.error('Errore durante l\'esecuzione dei test:', error);
  process.exit(1);
});
