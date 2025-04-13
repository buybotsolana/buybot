# Test Suite

Questa directory contiene i test automatizzati per il sistema BUYBOT, garantendo la qualità, la sicurezza e le performance del codice.

## Componenti

### Run Tests
`run_tests.js` - Script principale per l'esecuzione di tutti i test automatizzati.

### Security & Scalability Tests
`security_scalability_tests.js` - Test specifici per la sicurezza e la scalabilità del sistema.

### Test Results
Directory contenente i risultati dei test eseguiti, in formato JSON per facile analisi.

### Test Temp
Directory contenente file temporanei utilizzati durante l'esecuzione dei test.

## Tipi di Test

- **Test Unitari**: Verificano il corretto funzionamento dei singoli componenti
- **Test di Integrazione**: Verificano l'interazione tra diversi componenti
- **Test di Sicurezza**: Identificano potenziali vulnerabilità di sicurezza
- **Test di Performance**: Misurano le performance del sistema sotto carico
- **Test di Scalabilità**: Verificano la capacità del sistema di gestire volumi crescenti

## Esecuzione dei Test

```bash
# Eseguire tutti i test
npm test

# Eseguire solo i test di sicurezza
npm run test:security

# Eseguire solo i test di performance
npm run test:performance

# Eseguire test con report dettagliato
npm run test:report
```

## Configurazione dei Test

I test possono essere configurati nel file `package.json` nella root del progetto:

```json
"scripts": {
  "test": "node tests/run_tests.js",
  "test:security": "node tests/run_tests.js --security",
  "test:performance": "node tests/run_tests.js --performance",
  "test:report": "node tests/run_tests.js --report"
}
```

## Risultati dei Test

I risultati dei test vengono salvati nella directory `test_results` in formato JSON. Questi file possono essere analizzati per identificare problemi e aree di miglioramento.

Esempio di risultato di test:
```json
{
  "testSuite": "BundleEngine",
  "totalTests": 24,
  "passed": 23,
  "failed": 1,
  "skipped": 0,
  "duration": 1250,
  "failures": [
    {
      "test": "should handle concurrent transactions",
      "message": "Expected 10 transactions to complete, but only 9 completed",
      "stack": "..."
    }
  ]
}
```

## Integrazione con CI/CD

I test sono integrati con il sistema CI/CD di GitHub Actions, che esegue automaticamente tutti i test ad ogni push o pull request. Vedere il file `.github/workflows/test.yml` per i dettagli della configurazione.
