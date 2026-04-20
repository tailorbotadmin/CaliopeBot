#!/bin/bash

# Este script configura de forma automática el Workload Identity Federation (WIF)
# y la Service Account para permitir a GitHub Actions desplegar en CaliopeBot.

PROJECT_ID="caliopebot-dad29"
SA_NAME="github-actions-deployer"
POOL_NAME="github-actions-pool-2"
PROVIDER_NAME="github-provider"
REPO="tailorbotadmin/CaliopeBot"

echo "=========================================="
echo "Iniciando configuración CI/CD en Google Cloud"
echo "Proyecto: $PROJECT_ID"
echo "=========================================="

echo "1. Habilitando APIs necesarias..."
gcloud services enable iamcredentials.googleapis.com cloudresourcemanager.googleapis.com --project="${PROJECT_ID}"

echo "2. Creando Service Account..."
gcloud iam service-accounts create "${SA_NAME}" \
  --display-name="GitHub Actions Deployer" \
  --project="${PROJECT_ID}" || echo "La Service Account ya existe."

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "3. Asignando permisos (Roles) a la Service Account..."
ROLES=(
  "roles/run.admin"
  "roles/artifactregistry.writer"
  "roles/iam.serviceAccountUser"
  "roles/storage.admin"
)

for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None > /dev/null 2>&1
done

echo "4. Protegiendo y Creando Workload Identity Pool..."
gcloud iam workload-identity-pools create "${POOL_NAME}" \
  --location="global" \
  --description="Pool para GitHub Actions" \
  --display-name="GitHub Actions Pool" \
  --project="${PROJECT_ID}" || echo "El Pool ya existe."

echo "5. Creando Workload Identity Provider para tu repo ($REPO)..."
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
  --location="global" \
  --workload-identity-pool="${POOL_NAME}" \
  --display-name="Proveedor de GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${REPO}'" \
  --project="${PROJECT_ID}" || echo "El proveedor ya existe."

echo "6. Obteniendo números e IDs generados por Google Cloud..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

echo "7. Otorgando permiso al repositorio de Github para usar esta Service Account..."
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${REPO}"

echo ""
echo "=========================================="
echo "                 ÉXITO"
echo "=========================================="
echo "Google Cloud está 100% configurado."
echo ""
echo "Accede a tu Github > tailorbotadmin/CaliopeBot > Settings > Secrets and variables > Actions."
echo "Crea los siguientes Repository Secrets (copia y pega estos exactos valores):"
echo ""
echo "WIF_PROVIDER"
echo " $WIF_PROVIDER"
echo ""
echo "WIF_SERVICE_ACCOUNT"
echo " $SA_EMAIL"
echo ""
echo "GCP_PROJECT_ID"
echo " $PROJECT_ID"
echo "=========================================="
echo "Súbelos y dale a 'Re-run jobs' en tu pestaña Actions de Github."
