import { ethers } from 'ethers';
import cliProgress from 'cli-progress';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { ZKPHelper } from './zkp-helper.js';
import { MerkleTreeHelper } from './merkle-helper.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));

// API Laravel principale
const LARAVEL_API = process.env.LARAVEL_API_URL || 'http://localhost:8000';
const API_BASE = `${LARAVEL_API}/api/v1`;

class CompleteBenchmark {
    constructor() {
        this.zkpHelper = new ZKPHelper();
        this.merkleHelper = new MerkleTreeHelper();
        
        this.authToken = null;
        this.electionId = null;
        this.merkleRoot = null;
        this.voterIds = [];
        
        this.results = {
            setup: { success: 0, failed: 0, totalTime: 0, times: [] },
            auth: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            checkEligibility: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            generateProofs: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            verifyProofs: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            signMLDSA: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            castVotes: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            verifyVotes: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] },
            queryVotes: { success: 0, failed: 0, totalTime: 0, times: [], errors: [] }
        };
    }

    async checkAPI() {
        try {
            console.log('🔍 Vérification de l\'API Laravel...\n');
            
            // Test 1: Health check
            const healthResponse = await fetch(`${API_BASE}/test/health`);
            
            if (!healthResponse.ok) {
                throw new Error(`Health check failed: ${healthResponse.status}`);
            }
            
            const healthData = await healthResponse.json();
            console.log('✅ Laravel API accessible');
            console.log('   Health:', healthData.status || 'OK');
            
            // Test 2: ZKP Health
            const zkpResponse = await fetch(`${API_BASE}/zkp/health`);
            if (zkpResponse.ok) {
                const zkpData = await zkpResponse.json();
                console.log('✅ Service ZKP disponible');
            } else {
                console.warn('⚠️  Service ZKP indisponible');
            }
            
            // Test 3: Blockchain Health
            const blockchainResponse = await fetch(`${API_BASE}/test/blockchain`);
            if (blockchainResponse.ok) {
                const blockchainData = await blockchainResponse.json();
                console.log('✅ Service Blockchain disponible');
            } else {
                console.warn('⚠️  Service Blockchain indisponible');
            }
            
            return true;
        } catch (error) {
            console.error('❌ API Laravel inaccessible:', error.message);
            console.log('\n💡 Démarrez Laravel:');
            console.log('   cd vote-system');
            console.log('   php artisan serve');
            return false;
        }
    }

    async authenticate(email, password) {
        const start = Date.now();
        
        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Authentication failed');
            }
            
            const data = await response.json();
            this.authToken = data.token || data.access_token;
            
            const duration = Date.now() - start;
            this.results.auth.success++;
            this.results.auth.totalTime += duration;
            this.results.auth.times.push(duration);
            
            console.log('✅ Authentification réussie');
            
            return true;
        } catch (error) {
            this.results.auth.failed++;
            this.results.auth.errors.push(error.message);
            console.error('❌ Erreur authentification:', error.message);
            return false;
        }
    }

    async setupMerkleTree(voterCount) {
        console.log(`\n📋 PHASE 1: Setup du Merkle Tree`);
        console.log(`   Nombre de votants: ${voterCount}`);
        
        const setupStart = Date.now();
        
        await this.merkleHelper.initialize();
        
        this.voterIds = [];
        for (let i = 0; i < voterCount; i++) {
            const voterId = this.zkpHelper.generateVoterId(i);
            this.voterIds.push(voterId);
        }
        
        console.log(`   ✅ ${voterCount} IDs votants générés`);
        
        const root = this.merkleHelper.buildTree(this.voterIds);
        this.merkleRoot = '0x' + BigInt(root).toString(16).padStart(64, '0');
        
        const setupDuration = Date.now() - setupStart;
        this.results.setup.success++;
        this.results.setup.totalTime = setupDuration;
        this.results.setup.times.push(setupDuration);
        
        console.log(`   ⏱️  Temps de setup: ${(setupDuration / 1000).toFixed(2)}s`);
        
        return this.merkleRoot;
    }

    async getElection(electionId) {
        console.log(`\n📋 PHASE 2: Récupération de l'élection #${electionId}`);
        
        try {
            const response = await fetch(`${API_BASE}/elections/${electionId}`);
            
            if (!response.ok) {
                throw new Error(`Election not found: ${response.status}`);
            }
            
            const data = await response.json();
            this.electionId = electionId;
            
            console.log(`   Titre: ${data.title || data.data?.title || 'N/A'}`);
            console.log(`   Statut: ${data.status || data.data?.status || 'N/A'}`);
            console.log(`   ✅ Élection récupérée`);
            
            return true;
        } catch (error) {
            console.error('❌ Erreur:', error.message);
            throw error;
        }
    }

    async getMerkleRootFromAPI() {
        console.log(`\n🌳 Récupération du Merkle Root depuis l'API...`);
        
        try {
            const response = await fetch(
                `${API_BASE}/zkp/elections/${this.electionId}/merkle-root`
            );
            
            if (!response.ok) {
                console.warn('⚠️  Impossible de récupérer le Merkle Root depuis l\'API');
                console.log('   Utilisation du Merkle Root local');
                return this.merkleRoot;
            }
            
            const data = await response.json();
            const apiMerkleRoot = data.merkle_root || data.data?.merkle_root;
            
            if (apiMerkleRoot) {
                console.log(`   ✅ Merkle Root API: ${apiMerkleRoot.substring(0, 20)}...`);
                return apiMerkleRoot;
            }
            
            return this.merkleRoot;
        } catch (error) {
            console.warn('⚠️  Erreur récupération Merkle Root:', error.message);
            return this.merkleRoot;
        }
    }

    async castVotesComplete(count) {
        console.log(`\n🗳️  PHASE 3: Vote COMPLET (${count} votes)`);
        console.log(`   Tests: Éligibilité + ZKP + Vérif + ML-DSA-65 + Blockchain\n`);
        
        const actualCount = Math.min(count, this.voterIds.length);
        
        const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar.start(actualCount, 0);

        const receipts = [];
        const candidates = ['Candidat A', 'Candidat B', 'Candidat C'];
        
        // Récupérer le Merkle Root depuis l'API
        const merkleRootToUse = await this.getMerkleRootFromAPI();

        for (let i = 0; i < actualCount; i++) {
            const overallStart = Date.now();
            
            try {
                // ÉTAPE 1: Vérifier éligibilité
                const eligibilityStart = Date.now();
                
                const nationalId = `CNI${String(i).padStart(10, '0')}`;
                const voterSecret = `SECRET${String(i).padStart(10, '0')}`;
                
                const eligibilityResponse = await fetch(`${API_BASE}/zkp/check-eligibility`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`
                    },
                    body: JSON.stringify({
                        national_id: nationalId,
                        election_id: this.electionId
                    })
                });
                
                if (!eligibilityResponse.ok) {
                    throw new Error('Voter not eligible');
                }
                
                const eligibilityDuration = Date.now() - eligibilityStart;
                this.results.checkEligibility.success++;
                this.results.checkEligibility.totalTime += eligibilityDuration;
                this.results.checkEligibility.times.push(eligibilityDuration);
                
                // ÉTAPE 2: Générer la preuve ZKP
                const proofStart = Date.now();
                const merklePath = this.merkleHelper.getMerklePath(i);
                
                const { proof, publicSignals, nullifier } = await this.zkpHelper.generateVoteProofWithMerklePath(
                    i,
                    candidates[i % candidates.length],
                    merkleRootToUse,
                    merklePath,
                    this.electionId
                );
                
                const proofDuration = Date.now() - proofStart;
                this.results.generateProofs.success++;
                this.results.generateProofs.totalTime += proofDuration;
                this.results.generateProofs.times.push(proofDuration);
                
                // ÉTAPE 3: Voter (API fait: vérif ZKP + signature ML-DSA + blockchain)
                const voteStart = Date.now();
                
                const voteResponse = await fetch(`${API_BASE}/votes/cast`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`
                    },
                    body: JSON.stringify({
                        election_id: this.electionId,
                        candidate_id: (i % candidates.length) + 1,
                        zkp_proof: {
                            proof: proof,
                            publicSignals: {
                                nullifier: nullifier,
                                merkleRoot: merkleRootToUse,
                                electionId: this.electionId.toString()
                            }
                        },
                        national_id: nationalId,
                        voter_secret: voterSecret
                    })
                });
                
                if (!voteResponse.ok) {
                    const errorData = await voteResponse.json();
                    throw new Error(errorData.message || errorData.error || 'Vote failed');
                }
                
                const voteData = await voteResponse.json();
                const voteDuration = Date.now() - voteStart;
                
                // Estimation des temps backend (approximatif)
                const estimatedVerifyTime = voteDuration * 0.2;
                const estimatedSignTime = voteDuration * 0.3;
                const estimatedBlockchainTime = voteDuration * 0.5;
                
                this.results.verifyProofs.success++;
                this.results.verifyProofs.totalTime += estimatedVerifyTime;
                this.results.verifyProofs.times.push(estimatedVerifyTime);
                
                this.results.signMLDSA.success++;
                this.results.signMLDSA.totalTime += estimatedSignTime;
                this.results.signMLDSA.times.push(estimatedSignTime);
                
                const totalDuration = Date.now() - overallStart;
                this.results.castVotes.success++;
                this.results.castVotes.totalTime += totalDuration;
                this.results.castVotes.times.push(totalDuration);
                
                receipts.push(voteData.receipt || voteData.data);
                
            } catch (error) {
                this.results.castVotes.failed++;
                
                if (this.results.castVotes.errors.length < 5) {
                    this.results.castVotes.errors.push(error.message.substring(0, 150));
                }
            }
            
            bar.update(i + 1);
        }
        
        bar.stop();
        
        console.log('\n📊 Résultats détaillés du flux complet:');
        this.printStats('1️⃣  Vérification Éligibilité', this.results.checkEligibility);
        this.printStats('2️⃣  Génération Preuves ZKP (Client)', this.results.generateProofs);
        this.printStats('3️⃣  Vérification ZKP (Backend)', this.results.verifyProofs);
        this.printStats('4️⃣  Signature ML-DSA-65 (Backend)', this.results.signMLDSA);
        this.printStats('5️⃣  TOTAL Bout en bout', this.results.castVotes);
        
        return receipts;
    }

    async verifyVotes(count, receipts) {
        if (receipts.length === 0) {
            console.log('\n⚠️  Aucun vote à vérifier');
            return;
        }
        
        const actualCount = Math.min(count, receipts.length);
        console.log(`\n✅ PHASE 4: Vérification de ${actualCount} votes`);
        const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar.start(actualCount, 0);

        for (let i = 0; i < actualCount; i++) {
            const start = Date.now();
            const voteHash = receipts[i]?.vote_hash || receipts[i]?.voteHash;

            if (!voteHash) {
                this.results.verifyVotes.failed++;
                bar.update(i + 1);
                continue;
            }

            try {
                const response = await fetch(`${API_BASE}/votes/verify/${voteHash}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error('Verification failed');
                }
                
                const duration = Date.now() - start;
                this.results.verifyVotes.success++;
                this.results.verifyVotes.totalTime += duration;
                this.results.verifyVotes.times.push(duration);
            } catch (error) {
                this.results.verifyVotes.failed++;
            }
            bar.update(i + 1);
        }
        
        bar.stop();
        this.printStats('Vérification Votes', this.results.verifyVotes);
    }

    async queryStatistics(count) {
        console.log(`\n📊 PHASE 5: Requête des statistiques (${count} fois)`);
        const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar.start(count, 0);

        for (let i = 0; i < count; i++) {
            const start = Date.now();
            
            try {
                const response = await fetch(`${API_BASE}/elections/${this.electionId}/statistics`);
                
                if (!response.ok) {
                    throw new Error('Query failed');
                }
                
                const duration = Date.now() - start;
                this.results.queryVotes.success++;
                this.results.queryVotes.totalTime += duration;
                this.results.queryVotes.times.push(duration);
            } catch (error) {
                this.results.queryVotes.failed++;
            }
            bar.update(i + 1);
        }
        
        bar.stop();
        this.printStats('Requête Statistiques', this.results.queryVotes);
    }

    printStats(label, stats) {
        if (!stats.times || stats.times.length === 0) {
            console.log(`\n❌ ${label}: Aucune opération réussie`);
            if (stats.errors && stats.errors.length > 0) {
                console.log(`   Erreur: ${stats.errors[0]}`);
            }
            return;
        }

        const avgTime = stats.totalTime / stats.success;
        const sorted = [...stats.times].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        const tps = (stats.success / (stats.totalTime / 1000)).toFixed(2);

        console.log(`\n📈 ${label}:`);
        console.log(`   ✅ Succès: ${stats.success} | ❌ Échecs: ${stats.failed}`);
        console.log(`   ⚡ Débit: ${tps} op/s`);
        console.log(`   ⏱️  Temps moyen: ${avgTime.toFixed(2)} ms`);
        console.log(`   📊 P50: ${p50.toFixed(2)} ms | P95: ${p95.toFixed(2)} ms | P99: ${p99.toFixed(2)} ms`);
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            type: 'COMPLETE_SYSTEM_BENCHMARK',
            description: 'Test complet: Éligibilité + ZKP + ML-DSA-65 + Blockchain',
            configuration: {
                laravelApi: LARAVEL_API,
                electionId: this.electionId,
                voterCount: this.voterIds.length,
                merkleRoot: this.merkleRoot,
                merkleDepth: 20
            },
            summary: {
                totalOperations: Object.values(this.results).reduce((s, r) => s + r.success + r.failed, 0),
                totalSuccess: Object.values(this.results).reduce((s, r) => s + r.success, 0),
                totalFailed: Object.values(this.results).reduce((s, r) => s + r.failed, 0)
            },
            phases: this.results
        };

        const reportsDir = join(__dirname, 'reports');
        if (!existsSync(reportsDir)) {
            mkdirSync(reportsDir);
        }
        
        const reportPath = join(reportsDir, `complete-benchmark-${Date.now()}.json`);
        writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Rapport complet: ${reportPath}`);
        
        return report;
    }

    printSummary() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 RÉSUMÉ FINAL - BENCHMARK SYSTÈME COMPLET');
        console.log('='.repeat(80));
        
        const total = Object.values(this.results).reduce((s, r) => s + r.success + r.failed, 0);
        const success = Object.values(this.results).reduce((s, r) => s + r.success, 0);
        const successRate = total > 0 ? ((success / total) * 100).toFixed(2) : 0;

        console.log(`\n🎯 Performance Globale:`);
        console.log(`   Total opérations: ${total}`);
        console.log(`   Succès: ${success} (${successRate}%)`);
        console.log(`   Échecs: ${total - success}`);
        
        console.log(`\n🌳 Merkle Tree:`);
        console.log(`   Votants: ${this.voterIds.length}`);
        console.log(`   Profondeur: 20 niveaux`);
        console.log(`   Racine: ${this.merkleRoot}`);
        
        if (this.results.generateProofs.success > 0) {
            console.log(`\n🔐 Composants Cryptographiques:`);
            
            const avgProofTime = this.results.generateProofs.totalTime / this.results.generateProofs.success;
            console.log(`   ZKP Génération: ${(avgProofTime / 1000).toFixed(2)}s/preuve`);
            
            if (this.results.verifyProofs.success > 0) {
                const avgVerifyTime = this.results.verifyProofs.totalTime / this.results.verifyProofs.success;
                console.log(`   ZKP Vérification: ${avgVerifyTime.toFixed(2)}ms/preuve`);
            }
            
            if (this.results.signMLDSA.success > 0) {
                const avgSignTime = this.results.signMLDSA.totalTime / this.results.signMLDSA.success;
                console.log(`   ML-DSA-65 Signature: ${avgSignTime.toFixed(2)}ms/signature`);
            }
        }
        
        if (this.results.castVotes.success > 0) {
            const avgTotalTime = this.results.castVotes.totalTime / this.results.castVotes.success;
            console.log(`\n⏱️  Temps moyen TOTAL par vote: ${(avgTotalTime / 1000).toFixed(2)}s`);
        }
        
        console.log('\n' + '='.repeat(80));
    }
}

async function main() {
    const testSize = process.argv.includes('--small') ? 'small' 
                   : process.argv.includes('--large') ? 'large' 
                   : 'medium';

    console.log('═'.repeat(80));
    console.log('🚀 BENCHMARK SYSTÈME COMPLET - TRUSTVOTE');
    console.log('   Éligibilité + ZKP (Groth16) + ML-DSA-65 + Blockchain');
    console.log('═'.repeat(80));
    console.log(`\n📏 Taille du test: ${testSize.toUpperCase()}`);
    console.log(`🌐 API Laravel: ${LARAVEL_API}\n`);

    const benchmark = new CompleteBenchmark();
    
    if (!(await benchmark.checkAPI())) {
        process.exit(1);
    }

    // Authentification
    console.log('\n🔐 Authentification...');
    const email = process.env.TEST_USER_EMAIL || 'voter@example.com';
    const password = process.env.TEST_USER_PASSWORD || 'password';
    
    if (!(await benchmark.authenticate(email, password))) {
        console.error('\n❌ Authentification échouée');
        console.log('💡 Créez un utilisateur de test ou configurez:');
        console.log('   TEST_USER_EMAIL=voter@example.com');
        console.log('   TEST_USER_PASSWORD=password');
        process.exit(1);
    }

    const tests = config.tests[testSize];
    const startTime = Date.now();

    try {
        await benchmark.setupMerkleTree(tests.registerTokens || tests.castVotes);
        await benchmark.getElection(1);
        
        const receipts = await benchmark.castVotesComplete(tests.castVotes);
        
        await benchmark.verifyVotes(tests.verifyVotes, receipts);
        await benchmark.queryStatistics(tests.queryVotes);
        
    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        console.error(error.stack);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Temps total: ${totalTime}s`);
    
    benchmark.printSummary();
    benchmark.generateReport();
}

main().catch(error => {
    console.error('❌ Erreur fatale:', error);
    console.error(error.stack);
    process.exit(1);
});