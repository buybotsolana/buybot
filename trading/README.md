# Trading Components

Questa directory contiene i componenti di trading del sistema BUYBOT, responsabili dell'esecuzione delle operazioni di acquisto e vendita e del monitoraggio delle performance.

## Componenti

### Buy Transactions
`buy_transactions.js` - Gestisce tutte le operazioni di acquisto, inclusa l'ottimizzazione delle strategie di ingresso nel mercato.

### Sell Transactions
`sell_transactions.js` - Gestisce tutte le operazioni di vendita, inclusa l'ottimizzazione delle strategie di uscita dal mercato.

### Monitor System
`monitor_system.js` - Sistema di monitoraggio in tempo reale per tracciare le performance delle operazioni di trading.

## Funzionalità

- Esecuzione automatizzata di operazioni di trading
- Ottimizzazione delle strategie basata su condizioni di mercato
- Gestione dello slippage e protezione contro movimenti di prezzo avversi
- Monitoraggio in tempo reale delle performance
- Generazione di report dettagliati sulle operazioni

## Utilizzo

```javascript
const BuyTransactions = require('./trading/buy_transactions.js');
const SellTransactions = require('./trading/sell_transactions.js');
const MonitorSystem = require('./trading/monitor_system.js');

// Inizializzazione dei componenti
const buyManager = new BuyTransactions(config);
const sellManager = new SellTransactions(config);
const monitor = new MonitorSystem(config);

// Esecuzione di operazioni di acquisto
const buyResult = await buyManager.executeBuy({
  tokenAddress: 'TOKEN_ADDRESS',
  amount: 1000,
  maxSlippage: 0.5
});

// Esecuzione di operazioni di vendita
const sellResult = await sellManager.executeSell({
  tokenAddress: 'TOKEN_ADDRESS',
  amount: 500,
  minPrice: 0.01
});

// Avvio del monitoraggio
monitor.startMonitoring();
```

## Integrazione con Altri Componenti

I componenti di trading si integrano con:

- **Bundle Engine**: Per l'aggregazione delle transazioni
- **Swap Optimizer**: Per trovare le rotte di trading ottimali
- **Anti-Rug System**: Per la valutazione del rischio prima delle operazioni
- **Market Maker**: Per la stabilizzazione dei prezzi durante le operazioni

## Configurazione

Le strategie di trading possono essere configurate nel file `configure.js` nella root del progetto:

```javascript
// Esempio di configurazione
{
  trading: {
    defaultSlippage: 0.5,
    maxTransactionSize: 10000,
    retryAttempts: 3,
    monitoringInterval: 5000
  }
}
```
