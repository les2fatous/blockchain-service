#!/bin/bash

# Script de vérification des prérequis pour la simulation K6

echo "=============================================================="
echo "🔍 VÉRIFICATION DES PRÉREQUIS - SIMULATION K6"
echo "=============================================================="
echo ""

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

LARAVEL_URL="${LARAVEL_API_URL:-http://localhost:8000}"
ZKP_URL="${ZKP_SERVER_URL:-http://localhost:3002}"
ERRORS=0

# Fonction de vérification
check_service() {
    local name=$1
    local url=$2
    local endpoint=$3
    
    echo -n "Vérification $name... "
    
    if curl -s -o /dev/null -w "%{http_code}" "$url$endpoint" | grep -q "200"; then
        echo -e "${GREEN}✅ OK${NC}"
        return 0
    else
        echo -e "${RED}❌ ERREUR${NC}"
        echo "   URL testée: $url$endpoint"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

# Fonction de vérification commande
check_command() {
    local cmd=$1
    local name=$2
    
    echo -n "Vérification $name... "
    
    if command -v $cmd &> /dev/null; then
        echo -e "${GREEN}✅ OK${NC}"
        return 0
    else
        echo -e "${RED}❌ NON INSTALLÉ${NC}"
        ERRORS=$((ERRORS + 1))
        return 1
    fi
}

echo "📦 OUTILS REQUIS"
echo "--------------------------------------------------------------"
check_command "k6" "K6"
check_command "php" "PHP"
check_command "curl" "cURL"
echo ""

echo "🌐 SERVICES"
echo "--------------------------------------------------------------"
check_service "Backend Laravel" "$LARAVEL_URL" "/api/health"
check_service "Serveur ZKP" "$ZKP_URL" "/health"
echo ""

echo "🗄️  BASE DE DONNÉES"
echo "--------------------------------------------------------------"
echo -n "Vérification électeurs... "

# Compter les électeurs via API
VOTERS_RESPONSE=$(curl -s "$LARAVEL_URL/api/v1/test/voters-count")
VOTERS_COUNT=$(echo "$VOTERS_RESPONSE" | grep -o '"count":[0-9]*' | grep -o '[0-9]*' || echo "0")

if [ "$VOTERS_COUNT" -ge 1000 ]; then
    echo -e "${GREEN}✅ OK ($VOTERS_COUNT électeurs)${NC}"
else
    echo -e "${RED}❌ INSUFFISANT ($VOTERS_COUNT électeurs, 1000 requis)${NC}"
    echo "   Exécutez: php artisan db:seed --class=VotersSeeder"
    ERRORS=$((ERRORS + 1))
fi

echo -n "Vérification élection... "
ELECTION_STATUS=$(curl -s "$LARAVEL_URL/api/v1/elections" | grep -o '"status":"[^"]*' | head -1 | cut -d'"' -f4)

if [ "$ELECTION_STATUS" == "active" ]; then
    echo -e "${GREEN}✅ OK (active)${NC}"
else
    echo -e "${RED}❌ ERREUR (status: $ELECTION_STATUS)${NC}"
    echo "   Créez une élection active avec 2 candidats"
    ERRORS=$((ERRORS + 1))
fi

echo ""

echo "🔐 CRYPTOGRAPHIE"
echo "--------------------------------------------------------------"
echo -n "Vérification Merkle Root... "

MERKLE_RESPONSE=$(curl -s "$LARAVEL_URL/api/v1/zkp/elections/1/merkle-root")
if echo "$MERKLE_RESPONSE" | grep -q "merkle_root"; then
    MERKLE_ROOT=$(echo "$MERKLE_RESPONSE" | grep -o '"merkle_root":"[^"]*' | cut -d'"' -f4)
    echo -e "${GREEN}✅ OK${NC}"
    echo "   Root: ${MERKLE_ROOT:0:30}..."
else
    echo -e "${YELLOW}⚠️  NON GÉNÉRÉ${NC}"
    echo "   Exécutez dans tinker:"
    echo "   \$zkp = app(App\\Services\\Cryptography\\ZeroKnowledgeProofService::class);"
    echo "   \$zkp->generateVotersMerkleRoot(1);"
fi

echo ""

echo "📁 STRUCTURE"
echo "--------------------------------------------------------------"
echo -n "Vérification dossier reports... "
if [ -d "reports" ]; then
    echo -e "${GREEN}✅ OK${NC}"
else
    echo -e "${YELLOW}⚠️  ABSENT (création...)${NC}"
    mkdir -p reports
    echo "   Dossier créé"
fi

echo -n "Vérification script K6... "
if [ -f "k6-vote-simulation-fixed.js" ]; then
    echo -e "${GREEN}✅ OK${NC}"
else
    echo -e "${RED}❌ ABSENT${NC}"
    echo "   Créez le fichier k6-vote-simulation-fixed.js"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo "=============================================================="

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ TOUS LES PRÉREQUIS SONT OK${NC}"
    echo ""
    echo "🚀 Vous pouvez lancer la simulation:"
    echo ""
    echo "   k6 run k6-vote-simulation-fixed.js"
    echo ""
    echo "Ou pour un test rapide (1 vote):"
    echo ""
    echo "   k6 run --vus 1 --iterations 1 k6-vote-simulation-fixed.js"
    echo ""
    exit 0
else
    echo -e "${RED}❌ $ERRORS PROBLÈME(S) DÉTECTÉ(S)${NC}"
    echo ""
    echo "Corrigez les erreurs ci-dessus avant de lancer la simulation."
    echo ""
    echo "📚 Consultez GUIDE-SIMULATION-K6.md pour plus de détails."
    echo ""
    exit 1
fi