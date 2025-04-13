# Guida al Deployment di BuyBot Migliorato

Questa guida ti fornirà tutte le istruzioni necessarie per deployare e configurare il sistema BuyBot migliorato sulla rete Solana.

## Contenuti del Pacchetto

- **programs/**: Programmi ancillari migliorati (Bundle Engine, UltraGrowthBoostManager, ecc.)
- **trading/**: Script per le operazioni di trading
- **monitoring/**: Sistema di monitoraggio con dashboard in tempo reale
- **docs/**: Documentazione completa
- **wallet/**: Wallet Solana per il token BuyBot
- **token/**: Informazioni sul token BuyBot

## Prerequisiti

Prima di iniziare, assicurati di avere installato:

```bash
# Node.js e npm
sudo apt update
sudo apt install -y nodejs npm

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.17.0/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Configura la rete devnet
solana config set --url https://api.devnet.solana.com
```

## 1. Installazione

```bash
# Clona o estrai il pacchetto
cd /path/to/buybot_improved

# Installa le dipendenze
npm install
```

## 2. Configurazione del Wallet

```bash
# Imposta il wallet come predefinito
cp wallet/buybot_wallet.json ~/.config/solana/id.json

# Verifica che il wallet sia impostato correttamente
solana-keygen pubkey
# Output atteso: 2cbDkDJcbfrKk2rsj7dcRkWgSPwnsDQb2Vam6fSA7FhF

# Verifica il saldo del wallet
solana balance
```

**IMPORTANTE**: Conserva una copia sicura del file del wallet e della frase seed. Questi sono necessari per mantenere il controllo del token.

## 3. Deployment del Sistema

### Configurazione Completa

Per configurare tutti i componenti in un'unica operazione:

```bash
# Esegui lo script di configurazione
npm run configure
```

Questo script:
1. Verifica la configurazione del wallet
2. Inizializza il Bundle Engine migliorato
3. Inizializza l'UltraGrowthBoostManager
4. Avvia il sistema di monitoraggio
5. Configura gli altri programmi ancillari

### Deployment Manuale dei Singoli Componenti

Se preferisci deployare i componenti individualmente:

#### Bundle Engine Migliorato

```bash
# Inizializza il Bundle Engine migliorato
node -e "const { BundleEngineImproved } = require('./programs/bundle_engine_improved'); const { Connection } = require('@solana/web3.js'); const connection = new Connection('https://api.devnet.solana.com', 'confirmed'); const bundleEngine = new BundleEngineImproved(connection, '7PjHKEXQXewzv2FTi9oiPhaL3tE4xE8GPWAU5BDMdng7');"
```

#### UltraGrowthBoostManager

```bash
# Inizializza l'UltraGrowthBoostManager
node -e "const { UltraGrowthBoostManager } = require('./programs/ultra_growth_boost_manager'); const boostManager = new UltraGrowthBoostManager({ initialPrice: 0.000001, targetMarketcap: 20000000, totalSupply: 1000000000 });"
```

#### Sistema di Monitoraggio

```bash
# Avvia il sistema di monitoraggio
node monitoring/dashboard.js
```

## 4. Accesso al Dashboard di Monitoraggio

Dopo aver avviato il sistema di monitoraggio, puoi accedere al dashboard all'indirizzo:

```
http://localhost:3000
```

Il dashboard ti permette di:
- Monitorare il prezzo e il marketcap del token in tempo reale
- Visualizzare lo stato del Bundle Engine e dell'UltraGrowthBoostManager
- Ricevere avvisi per eventi critici
- Analizzare le prestazioni del sistema

## 5. Esecuzione di Transazioni

### Transazioni di Acquisto

```bash
# Esegui transazioni di acquisto
node trading/buy_transactions.js
```

### Transazioni di Vendita

```bash
# Esegui transazioni di vendita
node trading/sell_transactions.js
```

## 6. Simulazioni e Test

### Test di Alto Volume

```bash
# Esegui test di alto volume
node simulation/high_volume_test.js
```

### Simulazione di Crescita Parabolica

```bash
# Esegui simulazione di crescita parabolica
node simulation/parabolic_growth_test.js
```

### Simulazione di Crescita Parabolica Ottimizzata

```bash
# Esegui simulazione di crescita parabolica ottimizzata
node simulation/parabolic_optimized_test.js
```

## 7. Configurazione Avanzata

### Configurazione del Bundle Engine

Puoi personalizzare il comportamento del Bundle Engine modificando le costanti all'inizio del file `programs/bundle_engine_improved.js`:

```javascript
// Configurazione ottimizzata
const BUNDLE_SIZE = 10; // Dimensione del bundle
const BUNDLE_MIN_SIZE = 3; // Dimensione minima per l'esecuzione immediata
const BUNDLE_TIMEOUT = 30000; // Timeout in ms
const DYNAMIC_TIMEOUT = true; // Timeout dinamico
const FEE_PERCENTAGE = 0.1; // Fee percentuale
const MAX_WORKER_THREADS = Math.max(1, os.cpus().length - 1); // Worker threads
const PRIORITY_FEE_MICROLAMPORTS = 10000; // Fee di priorità
```

### Configurazione dell'UltraGrowthBoostManager

Puoi personalizzare il comportamento dell'UltraGrowthBoostManager modificando la configurazione quando lo inizializzi:

```javascript
const boostManager = new UltraGrowthBoostManager({
  enabled: true,
  initialPrice: 0.000001,
  targetMarketcap: 20000000,
  totalSupply: 1000000000,
  phases: {
    microCap: { 
      threshold: 100000, 
      boostPercentage: 800, 
      transactionsRequired: 20
    },
    smallCap: { 
      threshold: 1000000, 
      boostPercentage: 300, 
      transactionsRequired: 40
    },
    midCap: { 
      threshold: 5000000, 
      boostPercentage: 150, 
      transactionsRequired: 60
    },
    largeCap: { 
      threshold: 20000000, 
      boostPercentage: 80, 
      transactionsRequired: 100
    }
  },
  minIntervalBetweenBoosts: 3600000, // 1 ora in ms
  maxBoostsPerDay: 24,
  debugMode: false
});
```

## 8. Passaggio alla Mainnet

Quando sei pronto per passare alla mainnet:

1. Configura Solana per la mainnet:
   ```bash
   solana config set --url https://api.mainnet-beta.solana.com
   ```

2. Assicurati di avere SOL sufficienti nel wallet:
   ```bash
   solana balance
   ```

3. Crea un nuovo token sulla mainnet:
   ```bash
   solana-keygen new -o mainnet-token-keypair.json --no-bip39-passphrase
   spl-token create-token --decimals 9 mainnet-token-keypair.json
   ```

4. Aggiorna il file di configurazione con il nuovo indirizzo del token:
   ```javascript
   // In configure.js
   const TOKEN_ADDRESS = 'nuovo-indirizzo-token-mainnet';
   ```

5. Esegui lo script di configurazione:
   ```bash
   npm run configure
   ```

## 9. Risoluzione dei Problemi

### Errore: "Cannot find module"

```bash
# Reinstalla le dipendenze
npm install
```

### Errore: "Error: Unable to load keypair"

```bash
# Verifica che il file del wallet esista
ls -la ~/.config/solana/id.json

# Se non esiste, copialo dalla directory wallet
cp wallet/buybot_wallet.json ~/.config/solana/id.json
```

### Errore: "Error: Failed to send transaction"

```bash
# Verifica il saldo del wallet
solana balance

# Richiedi SOL dal faucet se necessario
solana airdrop 1
```

### Errore: "Error: Worker thread initialization failed"

```bash
# Disabilita i worker threads modificando la configurazione
# In programs/bundle_engine_improved.js
const MAX_WORKER_THREADS = 0;
```

## 10. Supporto e Risorse Aggiuntive

- **Documentazione Solana**: [https://docs.solana.com/](https://docs.solana.com/)
- **Documentazione SPL Token**: [https://spl.solana.com/token](https://spl.solana.com/token)
- **Solana Explorer**: [https://explorer.solana.com/](https://explorer.solana.com/)

Per ulteriore assistenza, contatta il team di supporto.

---

© 2025 BuyBot Team. Tutti i diritti riservati.
