# reorganize-zkp.ps1

Write-Host "Reorganisation de la structure ZKP..." -ForegroundColor Cyan

# Creer les dossiers manquants
$folders = @('keys', 'proofs', 'inputs', 'outputs')
foreach ($folder in $folders) {
    if (-Not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder | Out-Null
        Write-Host "Dossier cree: $folder" -ForegroundColor Green
    }
}

# Deplacer les fichiers vers keys/
Write-Host ""
Write-Host "Deplacement des cles cryptographiques..." -ForegroundColor Cyan

if (Test-Path "build/voter_eligibility_final.zkey") {
    Move-Item "build/voter_eligibility_final.zkey" "keys/" -Force
    Write-Host "voter_eligibility_final.zkey -> keys/" -ForegroundColor Green
}

if (Test-Path "build/verification_key.json") {
    Move-Item "build/verification_key.json" "keys/" -Force
    Write-Host "verification_key.json -> keys/" -ForegroundColor Green
}

if (Test-Path "build/pot15_final.ptau") {
    Move-Item "build/pot15_final.ptau" "keys/powers_of_tau_final.ptau" -Force
    Write-Host "powers_of_tau_final.ptau -> keys/" -ForegroundColor Green
}

# Copier verification_key.json a la racine pour le serveur
if (Test-Path "keys/verification_key.json") {
    Copy-Item "keys/verification_key.json" "../verification_key.json" -Force
    Write-Host "verification_key.json copie a la racine" -ForegroundColor Green
}

# Nettoyer les fichiers temporaires dans build/
Write-Host ""
Write-Host "Nettoyage des fichiers temporaires..." -ForegroundColor Yellow
Remove-Item "build/pot*.ptau" -ErrorAction SilentlyContinue
Remove-Item "build/voter_eligibility_0000.zkey" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Reorganisation terminee !" -ForegroundColor Green

Write-Host ""
Write-Host "Structure actuelle:" -ForegroundColor Cyan
Write-Host ""
Write-Host "keys/" -ForegroundColor Yellow
if (Test-Path "keys") {
    Get-ChildItem "keys" | ForEach-Object {
        $size = if ($_.Length -gt 1MB) { 
            "$([math]::Round($_.Length/1MB, 2)) MB" 
        } else { 
            "$([math]::Round($_.Length/1KB, 2)) KB" 
        }
        Write-Host "  $($_.Name) - $size" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "build/" -ForegroundColor Yellow
if (Test-Path "build") {
    Get-ChildItem "build" -File | ForEach-Object {
        $size = if ($_.Length -gt 1MB) { 
            "$([math]::Round($_.Length/1MB, 2)) MB" 
        } else { 
            "$([math]::Round($_.Length/1KB, 2)) KB" 
        }
        Write-Host "  $($_.Name) - $size" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "Fichiers prets a utiliser !" -ForegroundColor Green