import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function checkContract() {
    const provider = new ethers.JsonRpcProvider(process.env.BESU_RPC_URL || 'http://127.0.0.1:8545');
    const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY, provider);
    
    const contractPath = join(__dirname, '..', 'smart-contracts', 'VotingSystem.json');
    const contractJson = JSON.parse(readFileSync(contractPath, 'utf8'));
    
    const contract = new ethers.Contract(
        process.env.CONTRACT_ADDRESS,
        contractJson.abi,
        wallet
    );
    
    console.log('🔍 Vérification du contrat...\n');
    
    try {
        const authority = await contract.electionAuthority();
        console.log(`📋 Autorité électorale du contrat: ${authority}`);
        console.log(`👤 Votre wallet: ${wallet.address}`);
        console.log(`✅ Correspondance: ${authority.toLowerCase() === wallet.address.toLowerCase() ? 'OUI' : 'NON'}`);
        
        if (authority.toLowerCase() !== wallet.address.toLowerCase()) {
            console.log('\n⚠️  PROBLÈME: Votre wallet n\'est pas l\'autorité électorale!');
            console.log('\n💡 Solutions:');
            console.log('1. Utilisez la clé privée du compte qui a déployé le contrat');
            console.log('2. Ou redéployez le contrat avec votre wallet actuel');
        }
        
        // Vérifier le nombre d'élections existantes
        const electionCount = await contract.electionCount();
        console.log(`\n📊 Nombre d'élections existantes: ${electionCount}`);
        
        // Tester si on peut lire une élection existante
        if (electionCount > 0) {
            console.log('\n🔍 Test de lecture de l\'élection #1...');
            const [title, startTime, endTime, isActive, isClosed, totalVotes] = 
                await contract.getElection(1);
            console.log(`   Titre: ${title}`);
            console.log(`   Active: ${isActive}`);
            console.log(`   Fermée: ${isClosed}`);
            console.log(`   Votes: ${totalVotes}`);
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
}

checkContract();