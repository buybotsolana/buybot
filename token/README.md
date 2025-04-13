# Token Management

Questa directory contiene le informazioni e i componenti relativi al token BUYBOT sulla blockchain Solana.

## Componenti

### Token Info
`token_info.json` - File di configurazione contenente le informazioni principali sul token BUYBOT.

## Informazioni sul Token

- **Nome**: BuyBot
- **Simbolo**: BUYBOT
- **Blockchain**: Solana
- **Supply Totale**: 1,000,000,000 (1 miliardo)
- **Decimali**: 9
- **Data di Deployment**: 04/04/2025

## Distribuzione dei Token

- **Community & Liquidity**: 55% (550,000,000 BUYBOT)
- **Ecosystem Fund**: 20% (200,000,000 BUYBOT)
- **Team**: 10% (100,000,000 BUYBOT)
- **CEX**: 10% (100,000,000 BUYBOT)
- **Burning Reserve**: 5% (50,000,000 BUYBOT)

## Funzionalità

- **Gestione del Supply**: Controllo e monitoraggio del supply totale e circolante
- **Burning Mechanism**: Meccanismo di burning per ridurre il supply nel tempo
- **Vesting Schedule**: Programma di vesting per i token allocati al team e agli advisor
- **Tokenomics Monitoring**: Monitoraggio delle metriche chiave della tokenomics

## Utilizzo

```javascript
const TokenInfo = require('./token/token_info.json');

// Accesso alle informazioni sul token
console.log(`Token Name: ${TokenInfo.name}`);
console.log(`Token Symbol: ${TokenInfo.symbol}`);
console.log(`Total Supply: ${TokenInfo.totalSupply}`);

// Calcolo della distribuzione
const communityAllocation = TokenInfo.totalSupply * (TokenInfo.distribution.community / 100);
console.log(`Community Allocation: ${communityAllocation} ${TokenInfo.symbol}`);
```

## Integrazione con Altri Componenti

Le informazioni sul token si integrano con:

- **Bundle Engine**: Per la gestione delle transazioni token
- **Market Maker**: Per la stabilizzazione del prezzo del token
- **Monitoring System**: Per il monitoraggio delle metriche del token
- **Trading Components**: Per le operazioni di trading del token

## Tokenomics

La tokenomics di BUYBOT è progettata per incentivare l'utilizzo a lungo termine e la crescita sostenibile dell'ecosistema:

- **Fee Reduction**: I possessori di token ricevono sconti sulle fee di piattaforma
- **Governance**: I token conferiscono diritti di voto per le decisioni di protocollo
- **Staking Rewards**: Opportunità di reddito passivo per chi fa staking
- **Bundle Priority**: Priorità più alta per l'esecuzione dei bundle
- **Deflationary Mechanism**: Meccanismo deflazionistico per aumentare il valore nel tempo
