# setup-zkp.ps1
Write-Host "🔧 Compilation du circuit..." -ForegroundColor Cyan
circom circuits/voter_eligibility.circom --r1cs --wasm --sym -o build/

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Circuit compilé avec succès" -ForegroundColor Green
    
    Write-Host "`n🔐 Génération des clés cryptographiques..." -ForegroundColor Cyan
    
    # Powers of Tau
    snarkjs powersoftau new bn128 12 build/pot12_0000.ptau -v
    snarkjs powersoftau contribute build/pot12_0000.ptau build/pot12_0001.ptau --name="First" -v -e="random text"
    snarkjs powersoftau prepare phase2 build/pot12_0001.ptau build/pot12_final.ptau -v
    
    # Setup et clés
    snarkjs groth16 setup build/voter_eligibility.r1cs build/pot12_final.ptau build/voter_eligibility_0000.zkey
    snarkjs zkey contribute build/voter_eligibility_0000.zkey build/voter_eligibility_final.zkey --name="Contributor" -v -e="more random"
    snarkjs zkey export verificationkey build/voter_eligibility_final.zkey build/verification_key.json
    
    Write-Host "`n✅ Configuration ZKP terminée !" -ForegroundColor Green
    Write-Host "📁 Fichiers générés dans ./build/" -ForegroundColor Yellow
} else {
    Write-Host "❌ Erreur lors de la compilation" -ForegroundColor Red
}