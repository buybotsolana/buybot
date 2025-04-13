// Script per eseguire transazioni di vendita del token BuyBot
const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer } = require('@solana/spl-token');
const fs = require('fs');

async function executeSellTransactions() {
  try {
    // Configurazione della connessione a Solana devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Caricamento dei wallet
    const wallet1KeypairData = JSON.parse(fs.readFileSync('/home/ubuntu/buybot_token_package/wallet/test_wallet_1.json', 'utf-8'));
    const wallet1Keypair = Keypair.fromSecretKey(new Uint8Array(wallet1KeypairData));
    
    const wallet2KeypairData = JSON.parse(fs.readFileSync('/home/ubuntu/buybot_token_package/wallet/test_wallet_2.json', 'utf-8'));
    const wallet2Keypair = Keypair.fromSecretKey(new Uint8Array(wallet2KeypairData));
    
    // Indirizzo del token BuyBot
    const tokenAddress = new PublicKey('7PjHKEXQXewzv2FTi9oiPhaL3tE4xE8GPWAU5BDMdng7');
    
    console.log(`Wallet 1: ${wallet1Keypair.publicKey.toString()}`);
    console.log(`Wallet 2: ${wallet2Keypair.publicKey.toString()}`);
    
    // Ottenimento degli account associati al token per entrambi i wallet
    const wallet1TokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet1Keypair,
      tokenAddress,
      wallet1Keypair.publicKey
    );
    
    const wallet2TokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet1Keypair, // Utilizziamo wallet1 come payer per l'operazione
      tokenAddress,
      wallet2Keypair.publicKey
    );
    
    console.log(`Wallet 1 token account: ${wallet1TokenAccount.address.toString()}`);
    console.log(`Wallet 2 token account: ${wallet2TokenAccount.address.toString()}`);
    
    // Esecuzione di 5 transazioni di vendita (trasferimento da wallet1 a wallet2)
    const amounts = [1000, 1500, 2000, 2500, 3000];
    
    for (let i = 0; i < amounts.length; i++) {
      const amount = amounts[i];
      console.log(`\nEsecuzione transazione di vendita #${i+1}: ${amount} token da Wallet 1 a Wallet 2`);
      
      // Trasferimento dei token
      const transactionSignature = await transfer(
        connection,
        wallet1Keypair,
        wallet1TokenAccount.address,
        wallet2TokenAccount.address,
        wallet1Keypair,
        amount
      );
      
      console.log(`Transazione completata. Firma: ${transactionSignature}`);
      
      // Attesa di 2 secondi tra le transazioni
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('\nTutte le transazioni di vendita sono state completate con successo!');
    
    // Verifica dei saldi finali
    const wallet1Info = await connection.getTokenAccountBalance(wallet1TokenAccount.address);
    const wallet2Info = await connection.getTokenAccountBalance(wallet2TokenAccount.address);
    
    console.log(`\nSaldo finale Wallet 1: ${wallet1Info.value.uiAmount} token`);
    console.log(`Saldo finale Wallet 2: ${wallet2Info.value.uiAmount} token`);
    
    return {
      success: true,
      totalSold: amounts.reduce((a, b) => a + b, 0),
      wallet1FinalBalance: wallet1Info.value.uiAmount,
      wallet2FinalBalance: wallet2Info.value.uiAmount
    };
    
  } catch (error) {
    console.error('Errore durante l\'esecuzione delle transazioni di vendita:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { executeSellTransactions };

// Esecuzione diretta dello script se chiamato direttamente
if (require.main === module) {
  executeSellTransactions()
    .then(result => {
      console.log('\nRisultato delle transazioni di vendita:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error('Errore nell\'esecuzione dello script:', error);
    });
}
