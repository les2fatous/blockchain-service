// k6-load-test-suite.js - Suite complète de tests de charge
// Pour évaluer la capacité du système à l'échelle de millions d'utilisateurs

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// ========================================
// MÉTRIQUES PERSONNALISÉES
// ========================================

const voteSuccessRate = new Rate('vote_success_rate');
const voteDuration = new Trend('vote_duration');
const zkpGenerationTime = new Trend('zkp_generation_time');
const blockchainWriteTime = new Trend('blockchain_write_time');
const authTime = new Trend('auth_time');
const totalProcessTime = new Trend('total_process_time');

const voteErrors = new Counter('vote_errors');
const zkpErrors = new Counter('zkp_errors');
const authErrors = new Counter('auth_errors');
const blockchainErrors = new Counter('blockchain_errors');
const zkpTimeouts = new Counter('zkp_timeouts');

const concurrentVoters = new Gauge('concurrent_voters');
const votesPerSecond = new Rate('votes_per_second');

// ========================================
// CONFIGURATION DES TESTS
// ========================================

const LARAVEL_API = __ENV.LARAVEL_API_URL || 'http://localhost:8000';
const API_BASE = `${LARAVEL_API}/api/v1`;

// Choisir le scénario via variable d'environnement
const TEST_SCENARIO = __ENV.TEST_SCENARIO || 'smoke';

// ========================================
// SCÉNARIOS DE TEST
// ========================================

const scenarios = {
    // 1. SMOKE TEST - Vérification basique (2 min)
    smoke: {
        executor: 'constant-vus',
        vus: 2,
        duration: '2m',
        gracefulStop: '30s',
    },
    
    // 2. LOAD TEST - Charge normale attendue (15 min)
    // Simule 10,000 électeurs votant sur 2h → ~83 votes/min → ~20 VUs concurrent
    load: {
        executor: 'ramping-vus',
        stages: [
            { duration: '2m', target: 10 },   // Warm-up
            { duration: '10m', target: 50 },  // Charge normale
            { duration: '2m', target: 100 },  // Pic
            { duration: '1m', target: 0 },    // Cool-down
        ],
        gracefulStop: '30s',
    },
    
    // 3. STRESS TEST - Trouver les limites (20 min)
    // Augmentation progressive jusqu'à rupture
    stress: {
        executor: 'ramping-vus',
        stages: [
            { duration: '2m', target: 50 },
            { duration: '5m', target: 100 },
            { duration: '5m', target: 200 },
            { duration: '5m', target: 300 },
            { duration: '2m', target: 400 },
            { duration: '1m', target: 0 },
        ],
        gracefulStop: '30s',
    },
    
    // 4. SPIKE TEST - Pic soudain (10 min)
    // Simule un afflux massif au moment de l'ouverture du vote
    spike: {
        executor: 'ramping-vus',
        stages: [
            { duration: '30s', target: 10 },
            { duration: '30s', target: 500 }, // Pic brutal
            { duration: '5m', target: 500 },  // Maintien
            { duration: '2m', target: 10 },
            { duration: '1m', target: 0 },
        ],
        gracefulStop: '30s',
    },
    
    // 5. SOAK TEST - Endurance (2h)
    // Vérifier la stabilité sur longue durée (fuites mémoire, etc.)
    soak: {
        executor: 'constant-vus',
        vus: 100,
        duration: '2h',
        gracefulStop: '30s',
    },
    
    // 6. BREAKPOINT TEST - Capacité maximale (30 min)
    // Augmentation continue jusqu'à l'échec
    breakpoint: {
        executor: 'ramping-arrival-rate',
        startRate: 10,
        timeUnit: '1s',
        preAllocatedVUs: 500,
        maxVUs: 2000,
        stages: [
            { duration: '5m', target: 50 },    // 50 req/s
            { duration: '5m', target: 100 },   // 100 req/s
            { duration: '5m', target: 200 },   // 200 req/s
            { duration: '5m', target: 300 },   // 300 req/s
            { duration: '5m', target: 400 },   // 400 req/s
            { duration: '5m', target: 500 },   // 500 req/s
        ],
        gracefulStop: '30s',
    },
};

export const options = {
    scenarios: {
        [TEST_SCENARIO]: scenarios[TEST_SCENARIO],
    },
    
    thresholds: {
        // Seuils différents selon le test
        ...(TEST_SCENARIO === 'smoke' ? {
            'http_req_duration': ['p(95)<5000'],
            'vote_success_rate': ['rate>0.99'],
        } : {}),
        
        ...(TEST_SCENARIO === 'load' ? {
            'http_req_duration': ['p(95)<10000'],
            'http_req_duration{type:zkp}': ['p(95)<120000'],
            'vote_success_rate': ['rate>0.95'],
            'zkp_generation_time': ['p(95)<120000'],
        } : {}),
        
        ...(TEST_SCENARIO === 'stress' || TEST_SCENARIO === 'spike' ? {
            'http_req_duration': ['p(95)<20000'],
            'vote_success_rate': ['rate>0.80'],
        } : {}),
        
        ...(TEST_SCENARIO === 'soak' ? {
            'http_req_duration': ['p(95)<15000'],
            'vote_success_rate': ['rate>0.90'],
            'http_req_failed': ['rate<0.15'],
        } : {}),
        
        ...(TEST_SCENARIO === 'breakpoint' ? {
            'http_req_failed': ['rate<0.5'],
        } : {}),
    },
    
    summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ========================================
// DONNÉES DE TEST
// ========================================

function generateVoters(count = 1000) {
    const voters = [];
    for (let i = 1; i <= count; i++) {
        const nationalId = '199001' + String(i).padStart(8, '0');
        const secret = `voter_secret_${nationalId}_${String(i).padStart(10, '0')}_k6test`;
        
        voters.push({
            cni: nationalId,
            email: `voter${i}@test.com`,
            password: 'TestPassword123!',
            secret: secret
        });
    }
    return voters;
}

const VOTERS = generateVoters(1000);

// ========================================
// SETUP
// ========================================

export function setup() {
    console.log('\n' + '='.repeat(80));
    console.log(`🚀 K6 LOAD TEST SUITE - SCÉNARIO: ${TEST_SCENARIO.toUpperCase()}`);
    console.log('='.repeat(80));
    console.log(`📊 Électeurs disponibles: ${VOTERS.length}`);
    console.log(`🌐 API Backend: ${API_BASE}`);
    console.log(`🎯 Objectif: Évaluer capacité pour millions d'utilisateurs`);
    console.log('='.repeat(80) + '\n');
    
    // Vérifier services
    console.log('🔍 Vérification des services...\n');
    
    const healthResponse = http.get(`${API_BASE}/test/health`, { timeout: '10s' });
    if (healthResponse.status !== 200) {
        console.error('❌ Backend inaccessible');
        return { error: 'Backend down' };
    }
    console.log('✅ Backend: OK');
    
    // Récupérer élection
    let electionId = 1;
    try {
        const electionsResponse = http.get(`${API_BASE}/elections`);
        if (electionsResponse.status === 200) {
            const elections = JSON.parse(electionsResponse.body);
            if (elections.data && elections.data.length > 0) {
                electionId = elections.data[0].id;
                console.log(`✅ Élection: ID ${electionId}`);
            }
        }
    } catch (e) {
        console.log('⚠️  Élection par défaut: ID 1');
    }
    
    // Afficher scénario
    console.log('\n📋 Détails du scénario:');
    const scenario = scenarios[TEST_SCENARIO];
    if (scenario.executor === 'constant-vus') {
        console.log(`   Type: Charge constante`);
        console.log(`   VUs: ${scenario.vus}`);
        console.log(`   Durée: ${scenario.duration}`);
    } else if (scenario.executor === 'ramping-vus') {
        console.log(`   Type: Charge progressive (ramping)`);
        console.log(`   Étapes:`);
        scenario.stages.forEach((stage, i) => {
            console.log(`      ${i + 1}. ${stage.duration} → ${stage.target} VUs`);
        });
    } else if (scenario.executor === 'ramping-arrival-rate') {
        console.log(`   Type: Taux d'arrivée (arrival rate)`);
        console.log(`   VUs max: ${scenario.maxVUs}`);
        console.log(`   Étapes (req/s):`);
        scenario.stages.forEach((stage, i) => {
            console.log(`      ${i + 1}. ${stage.duration} → ${stage.target} req/s`);
        });
    }
    
    console.log('\n✅ Initialisation terminée - Démarrage du test\n');
    console.log('='.repeat(80) + '\n');
    
    return {
        electionId,
        voters: VOTERS,
        apiBase: API_BASE,
        scenario: TEST_SCENARIO,
        startTime: Date.now()
    };
}

// ========================================
// FONCTION PRINCIPALE
// ========================================

export default function(data) {
    if (data.error) {
        console.error(`❌ Setup failed: ${data.error}`);
        return;
    }
    
    const { electionId, voters, apiBase } = data;
    const processStart = Date.now();

    // Sélectionner électeur
    const voterIndex = Math.floor(Math.random() * voters.length);
    const voter = voters[voterIndex];
    const voterId = `V${voterIndex + 1}`;
    
    // Métrique de concurrence
    concurrentVoters.add(1);
    
    let authToken = null;
    let zkpProof = null;
    let zkpPublicSignals = null;
    let success = false;
    
    group('Processus de Vote Complet', function() {
        
        // ==========================================
        // ÉTAPE 1: AUTHENTIFICATION
        // ==========================================
        group('Auth', function() {
            const authStart = Date.now();
            
            const authResponse = http.post(
                `${apiBase}/auth/login`,
                JSON.stringify({
                    email: voter.email,
                    password: voter.password
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    tags: { type: 'auth' },
                    timeout: '60s'
                }
            );

            authTime.add(Date.now() - authStart);

            const authOk = check(authResponse, {
                'auth_success': (r) => r.status === 200,
            });

            if (authOk) {
                const authData = JSON.parse(authResponse.body);
                authToken = authData.data.token;
            } else {
                authErrors.add(1);
                return;
            }
        });

        if (!authToken) return;
        
        sleep(0.3);

        // ==========================================
        // ÉTAPE 2: GÉNÉRATION ZKP
        // ==========================================
        group('ZKP', function() {
            const zkpStart = Date.now();
            
            const zkpResponse = http.post(
                `${apiBase}/zkp/generate-proof`,
                JSON.stringify({
                    election_id: electionId,
                    national_id: voter.cni,
                    voter_secret: voter.secret
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'Accept': 'application/json'
                    },
                    tags: { type: 'zkp' },
                    timeout: '120s'
                }
            );

            const zkpTime = Date.now() - zkpStart;
            zkpGenerationTime.add(zkpTime);

            if (zkpResponse.status === 0 || zkpResponse.error) {
                zkpTimeouts.add(1);
                zkpErrors.add(1);
                return;
            }

            const zkpOk = check(zkpResponse, {
                'zkp_success': (r) => r.status === 200,
            });

            if (zkpOk) {
                const zkpData = JSON.parse(zkpResponse.body);
                zkpProof = zkpData.data.proof;
                zkpPublicSignals = zkpData.data.publicSignals;
            } else {
                zkpErrors.add(1);
                return;
            }
        });

        if (!zkpProof) return;
        
        sleep(0.5);

        // ==========================================
        // ÉTAPE 3: VOTE + BLOCKCHAIN
        // ==========================================
        group('Vote', function() {
            const voteStart = Date.now();
            
            const candidateId = Math.random() < 0.5 ? 1 : 2;
            
            const voteResponse = http.post(
                `${apiBase}/votes/cast`,
                JSON.stringify({
                    election_id: electionId,
                    candidate_id: candidateId,
                    zkp_proof: zkpProof,
                    zkp_public_signals: zkpPublicSignals
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'Accept': 'application/json'
                    },
                    tags: { type: 'vote' },
                    timeout: '30s'
                }
            );

            const voteDur = Date.now() - voteStart;
            voteDuration.add(voteDur);
            blockchainWriteTime.add(voteDur * 0.3); // Estimation

            success = check(voteResponse, {
                'vote_success': (r) => r.status === 200 || r.status === 201,
            });

            voteSuccessRate.add(success);
            
            if (success) {
                votesPerSecond.add(1);
            } else {
                voteErrors.add(1);
                if (voteResponse.status >= 500) {
                    blockchainErrors.add(1);
                }
            }
        });
    });
    
    // Temps total du processus
    totalProcessTime.add(Date.now() - processStart);
    
    // Pause réaliste selon le scénario
    const sleepTime = TEST_SCENARIO === 'spike' || TEST_SCENARIO === 'breakpoint' 
        ? Math.random() * 5 + 2    // 2-7s pour tests intensifs
        : Math.random() * 15 + 10; // 10-25s pour tests normaux
    
    sleep(sleepTime);
}

// ========================================
// TEARDOWN
// ========================================

export function teardown(data) {
    const duration = Math.round((Date.now() - data.startTime) / 1000);
    
    console.log('\n' + '='.repeat(80));
    console.log(`🏁 TEST ${data.scenario.toUpperCase()} TERMINÉ`);
    console.log('='.repeat(80));
    console.log(`⏱️  Durée réelle: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log('='.repeat(80) + '\n');
}

// ========================================
// RAPPORT DÉTAILLÉ
// ========================================

export function handleSummary(data) {
    const metrics = data.metrics;
    const duration = Math.round(data.state.testRunDurationMs / 1000);
    const scenario = __ENV.TEST_SCENARIO || 'smoke';
    
    console.log('\n' + '='.repeat(80));
    console.log(`📊 RAPPORT DE PERFORMANCE - ${scenario.toUpperCase()}`);
    console.log('='.repeat(80) + '\n');
    
    // STATISTIQUES GÉNÉRALES
    console.log('🎯 STATISTIQUES GÉNÉRALES');
    console.log('-'.repeat(80));
    console.log(`   Scénario: ${scenario}`);
    console.log(`   Durée: ${Math.floor(duration / 60)}m ${duration % 60}s`);
    console.log(`   VUs max: ${metrics.vus_max?.values.max || 0}`);
    console.log(`   Itérations: ${metrics.iterations?.values.count || 0}`);
    console.log(`   Requêtes HTTP: ${metrics.http_reqs?.values.count || 0}`);
    
    if (metrics.http_reqs) {
        const reqPerSec = (metrics.http_reqs.values.count / duration).toFixed(2);
        console.log(`   Requêtes/sec: ${reqPerSec}`);
    }
    console.log('');
    
    // PERFORMANCE GLOBALE
    console.log('⚡ PERFORMANCE GLOBALE');
    console.log('-'.repeat(80));
    if (metrics.total_process_time) {
        console.log(`   Temps total moyen: ${Math.round(metrics.total_process_time.values.avg / 1000)}s`);
        console.log(`   Min: ${Math.round(metrics.total_process_time.values.min / 1000)}s`);
        console.log(`   Max: ${Math.round(metrics.total_process_time.values.max / 1000)}s`);
        console.log(`   P95: ${Math.round(metrics.total_process_time.values['p(95)'] / 1000)}s`);
    }
    console.log('');
    
    // DÉTAILS PAR ÉTAPE
    if (metrics.auth_time) {
        console.log('🔐 AUTHENTIFICATION');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.auth_time.values.avg)}ms`);
        console.log(`   P95: ${Math.round(metrics.auth_time.values['p(95)'])}ms`);
        console.log(`   P99: ${Math.round(metrics.auth_time.values['p(99)'])}ms`);
        if (metrics.auth_errors) {
            console.log(`   ❌ Erreurs: ${metrics.auth_errors.values.count}`);
        }
        console.log('');
    }
    
    if (metrics.zkp_generation_time) {
        console.log('🔐 GÉNÉRATION ZKP');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.zkp_generation_time.values.avg / 1000)}s`);
        console.log(`   P90: ${Math.round(metrics.zkp_generation_time.values['p(90)'] / 1000)}s`);
        console.log(`   P95: ${Math.round(metrics.zkp_generation_time.values['p(95)'] / 1000)}s`);
        console.log(`   P99: ${Math.round(metrics.zkp_generation_time.values['p(99)'] / 1000)}s`);
        console.log(`   Max: ${Math.round(metrics.zkp_generation_time.values.max / 1000)}s`);
        if (metrics.zkp_timeouts) {
            console.log(`   ⏱️  Timeouts: ${metrics.zkp_timeouts.values.count}`);
        }
        if (metrics.zkp_errors) {
            console.log(`   ❌ Erreurs: ${metrics.zkp_errors.values.count}`);
        }
        console.log('');
    }
    
    if (metrics.vote_duration) {
        console.log('🗳️  SOUMISSION VOTE');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.vote_duration.values.avg / 1000)}s`);
        console.log(`   P95: ${Math.round(metrics.vote_duration.values['p(95)'] / 1000)}s`);
        console.log(`   P99: ${Math.round(metrics.vote_duration.values['p(99)'] / 1000)}s`);
        if (metrics.vote_errors) {
            console.log(`   ❌ Erreurs: ${metrics.vote_errors.values.count}`);
        }
        console.log('');
    }
    
    // TAUX DE SUCCÈS
    if (metrics.vote_success_rate) {
        const rate = metrics.vote_success_rate.values.rate * 100;
        const status = rate >= 95 ? '✅' : rate >= 80 ? '⚠️' : '❌';
        console.log('📈 TAUX DE SUCCÈS');
        console.log('-'.repeat(80));
        console.log(`   ${status} Vote: ${rate.toFixed(2)}%`);
        console.log('');
    }
    
    // CAPACITÉ
    if (metrics.votes_per_second && metrics.votes_per_second.values.count > 0) {
        console.log('🚀 CAPACITÉ DU SYSTÈME');
        console.log('-'.repeat(80));
        const votesCount = metrics.iterations?.values.count || 0;
        const successfulVotes = Math.round(votesCount * (metrics.vote_success_rate?.values.rate || 0));
        const votesPerSec = (successfulVotes / duration).toFixed(2);
        const votesPerMin = (votesPerSec * 60).toFixed(0);
        const votesPerHour = (votesPerSec * 3600).toFixed(0);
        
        console.log(`   Votes réussis: ${successfulVotes}`);
        console.log(`   Votes/seconde: ${votesPerSec}`);
        console.log(`   Votes/minute: ${votesPerMin}`);
        console.log(`   Votes/heure: ${votesPerHour}`);
        console.log('');
        
        // PROJECTION
        console.log('PROJECTION ÉCHELLE RÉELLE');
        console.log('-'.repeat(80));
        const hoursFor100k = (100000 / parseFloat(votesPerHour)).toFixed(1);
        const hoursFor1M = (1000000 / parseFloat(votesPerHour)).toFixed(1);
        const hoursFor10M = (10000000 / parseFloat(votesPerHour)).toFixed(1);
        
        console.log(`   100,000 votes → ${hoursFor100k}h`);
        console.log(`   1,000,000 votes → ${hoursFor1M}h (${(hoursFor1M / 24).toFixed(1)} jours)`);
        console.log(`   10,000,000 votes → ${hoursFor10M}h (${(hoursFor10M / 24).toFixed(1)} jours)`);
        console.log('');
    }
    
    // RECOMMANDATIONS
    console.log('RECOMMANDATIONS');
    console.log('-'.repeat(80));
    
    const successRate = (metrics.vote_success_rate?.values.rate || 0) * 100;
    const p95Time = (metrics.total_process_time?.values['p(95)'] || 0) / 1000;
    
    if (successRate < 95) {
        console.log('   ⚠️  Taux de succès < 95% → Optimiser la stabilité');
    }
    if (p95Time > 60) {
        console.log('   ⚠️  P95 > 60s → Optimiser le serveur ZKP');
    }
    if (metrics.zkp_timeouts && metrics.zkp_timeouts.values.count > 10) {
        console.log('   ⚠️  Trop de timeouts ZKP → Augmenter ressources serveur');
    }
    
    if (successRate >= 95 && p95Time <= 60) {
        console.log('   ✅ Performance acceptable pour déploiement');
    }
    
    console.log('');
    console.log('='.repeat(80) + '\n');
    
    // Sauvegarder rapports
    const timestamp = new Date().toISOString().replace(/:/g, '-').substring(0, 19);
    
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
        [`reports/load-test-${scenario}-${timestamp}.html`]: htmlReport(data),
        [`reports/load-test-${scenario}-${timestamp}.json`]: JSON.stringify(data, null, 2),
    };
}