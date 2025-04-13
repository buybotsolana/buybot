# Sistema di Monitoraggio

Questa directory contiene il sistema di monitoraggio in tempo reale di BUYBOT, che fornisce metriche, analisi e dashboard per il controllo delle performance.

## Componenti

### Dashboard
`dashboard.js` - Implementa un'interfaccia web per la visualizzazione in tempo reale delle metriche e delle performance.

### Public
Directory contenente i file statici (HTML, CSS, JavaScript) per l'interfaccia utente del dashboard.

### Logs
Directory contenente i file di log generati dal sistema di monitoraggio.

## Funzionalità

- **Monitoraggio in tempo reale**: Visualizzazione delle metriche di performance in tempo reale
- **Analisi storica**: Grafici e report sulle performance passate
- **Sistema di allerta**: Notifiche per eventi critici o anomalie
- **Esportazione dati**: Possibilità di esportare dati e report in vari formati
- **Personalizzazione**: Dashboard personalizzabili in base alle esigenze dell'utente

## Utilizzo

```javascript
const MonitoringSystem = require('./monitoring/dashboard.js');

// Inizializzazione del sistema di monitoraggio
const monitor = new MonitoringSystem({
  port: 3000,
  logLevel: 'info',
  alertThreshold: 0.05
});

// Avvio del server dashboard
monitor.startServer();

// Registrazione di metriche personalizzate
monitor.registerMetric('transaction_success_rate', () => calculateSuccessRate());
monitor.registerMetric('average_slippage', () => calculateAverageSlippage());

// Configurazione di allerte
monitor.setAlert('high_slippage', {
  condition: (value) => value > 0.02,
  message: 'Slippage superiore al 2%',
  severity: 'warning'
});
```

## Accesso al Dashboard

Una volta avviato, il dashboard è accessibile all'indirizzo:
```
http://localhost:3000
```

## Integrazione con Altri Componenti

Il sistema di monitoraggio si integra con:

- **Bundle Engine**: Per monitorare l'efficienza dell'aggregazione delle transazioni
- **Trading Components**: Per tracciare le performance delle operazioni di trading
- **Anti-Rug System**: Per visualizzare i punteggi di rischio
- **Market Maker**: Per monitorare la stabilità dei prezzi e la profondità di mercato

## Requisiti

- Node.js v20.18.0 o superiore
- Socket.IO per gli aggiornamenti in tempo reale
- Express.js per il server web
- Chart.js per la visualizzazione dei grafici
