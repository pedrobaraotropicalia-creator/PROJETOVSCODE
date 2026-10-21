# Fechamento de Caixa

Aplicacao web para controle de fechamento de caixa em rede de restaurantes. As unidades oficiais sao TERRA E MAR, RESTAURANTE E PIZZARIA, DELIVERY e DOCELATTO.

## Requisitos

- Node.js 22.12 ou superior (o `better-sqlite3` 13 e o `vitest` 5 exigem Node 22)
- npm 10 ou superior

## Rodar localmente

```bash
npm install
cp .env.example .env
npm run dev
```

API: http://localhost:3000/api
Frontend: http://localhost:5173 (o Vite repassa `/api` para a porta da API; `WEB_PORT` muda a porta do frontend)

Variaveis obrigatorias: `JWT_SECRET` e `ADMIN_EMAIL`. O servidor nao sobe sem elas.

O usuario dono nasce na primeira partida do servidor a partir de `ADMIN_EMAIL` e `ADMIN_PASSWORD` (minimo de 8 caracteres), so quando ainda nao existe. O cadastro pela tela de login recusa esse e-mail. Para redefinir a senha do dono para a `ADMIN_PASSWORD` do `.env`:

```bash
npm run server:seed
```

## Producao

```bash
npm install
npm run build
npm start
```

Use um processo como PM2, Nginx e HTTPS (Certbot). Mantenha o arquivo SQLite em um disco persistente, por exemplo `/var/lib/fechamento-caixa/caixa.db`. Nunca versione `.env` ou o arquivo `.db`.

## Deploy no Cloud Run

Cada push na `main` dispara o gatilho do Cloud Build `cloudrun-financeiro-southamerica-east1-pedrobaraotropicalia-piy` (regiao `southamerica-east1`). Ele gera a imagem com o `Dockerfile` da raiz e faz o deploy do servico `financeiro` (projeto `financeiroapp-508921`). O SQLite fica no disco em memoria da instancia. O [Litestream](https://litestream.io) copia cada escrita para um bucket do Cloud Storage, e na partida `deploy/iniciar.sh` restaura o banco do bucket. Sem `LITESTREAM_BUCKET`, o banco se perde quando a instancia desliga.

### Gatilho de deploy

A configuracao do build fica no proprio gatilho, em YAML inline (Cloud Build > Gatilhos > Editar > Configuracao > Abrir editor). Ela tem tres passos: `docker build` com o `Dockerfile`, `docker push` e `gcloud run services update --image`. O deploy troca so a imagem e mantem as variaveis e os secrets do servico. O passo de build:

```yaml
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - '--no-cache'
      - '--network=cloudbuild'
      - '-t'
      - >-
        $_AR_HOSTNAME/$_AR_PROJECT_ID/$_AR_REPOSITORY/$REPO_NAME/$_SERVICE_NAME:$COMMIT_SHA
      - '-f'
      - Dockerfile
      - .
    id: Build
```

A implantacao continua criada pela tela do Cloud Run usa Buildpacks por padrao (`pack build`). O Buildpacks ignora o `Dockerfile` e sobe o app com `npm start`, sem o Litestream: o banco volta a se perder a cada reinicio e o log da partida mostra `> start` em vez das linhas do Litestream. Se o gatilho for recriado, troque o passo de build de novo. A execucao manual (Executar > Executar gatilho, branch `main`) refaz o deploy do ultimo commit.

### Configuracao no Google Cloud

Feita uma vez, em 20/10/2026, antes do primeiro deploy com o Litestream (no Cloud Shell; troque `CONTA` pela conta de servico do passo 2):

1. Crie o bucket na mesma regiao, sem acesso publico:
   ```bash
   gcloud storage buckets create gs://financeiroapp-508921-caixa --project=financeiroapp-508921 --location=southamerica-east1 --uniform-bucket-level-access --public-access-prevention
   ```
2. Descubra a conta de servico do Cloud Run. Se vier vazio, e a conta padrao do Compute, `NUMERO_DO_PROJETO-compute@developer.gserviceaccount.com`:
   ```bash
   gcloud run services describe financeiro --project=financeiroapp-508921 --region=southamerica-east1 --format="value(spec.template.spec.serviceAccountName)"
   ```
   De a ela acesso aos objetos do bucket:
   ```bash
   gcloud storage buckets add-iam-policy-binding gs://financeiroapp-508921-caixa --member=serviceAccount:CONTA --role=roles/storage.objectAdmin
   ```
3. Guarde a senha inicial do dono no Secret Manager. O `read -s` pede a senha sem mostra-la nem grava-la no historico:
   ```bash
   gcloud services enable secretmanager.googleapis.com --project=financeiroapp-508921
   read -s SENHA && printf '%s' "$SENHA" | gcloud secrets create financeiro-admin-password --project=financeiroapp-508921 --replication-policy=automatic --data-file=- && unset SENHA
   gcloud secrets add-iam-policy-binding financeiro-admin-password --project=financeiroapp-508921 --member=serviceAccount:CONTA --role=roles/secretmanager.secretAccessor
   ```
4. Ligue o bucket e a senha no servico. O gatilho de deploy troca so a imagem, entao as duas devem continuar nas revisoes seguintes (confira na primeira):
   ```bash
   gcloud run services update financeiro --project=financeiroapp-508921 --region=southamerica-east1 --update-env-vars=LITESTREAM_BUCKET=financeiroapp-508921-caixa --update-secrets=ADMIN_PASSWORD=financeiro-admin-password:latest
   ```
5. Confira que o gatilho monta a imagem com o `Dockerfile` (secao anterior) e que o servico continua com no maximo 1 instancia. Faca o merge na `main` fora do horario das lojas. O que estiver no banco atual do servico se perde nesse deploy, como em todo deploy ate aqui.
6. Nos logs da primeira partida aparecem `no matching backups found` (bucket vazio), `replicating to` e `Usuario dono criado`, e o bucket ganha a pasta `caixa/ltx/`. Depois de uns 15 minutos sem uso a instancia desliga; entre de novo e confira que os dados continuam la.

### Cuidados

- O Litestream exige um unico replicador: nunca mais de 1 instancia, nem dois servicos no mesmo bucket.
- Faca deploy fora do horario das lojas: por alguns segundos a instancia antiga e a nova rodam juntas, e o que for gravado nesse intervalo se perde.
- Cada escrita so responde depois de o Litestream confirmar o envio ao bucket (`server/src/replicacao.ts`), entao o Cloud Run continua cobrado por requisicao, sem CPU sempre alocada. O bucket custa centavos por mes.
- O bucket guarda uma semana de copias (`deploy/litestream.yml`). Para ver o banco de um momento anterior, numa maquina com acesso ao bucket: `litestream restore -o caixa.db -timestamp 2026-10-20T15:00:00Z gs://financeiroapp-508921-caixa/caixa`.

## Alternativa: VM no Compute Engine

1. Crie um projeto no Google Cloud, ative faturamento e Compute Engine API.
2. Crie uma VM Ubuntu `e2-small` e reserve IP estatico.
3. Instale Node.js 22.12+, Git, Nginx e PM2.
4. Clone o repositorio e execute `npm ci --ignore-scripts` (o `better-sqlite3` ja traz o binario pronto; sem a opcao o npm tenta compilar e falha sem Python e compilador), configure `.env`, crie a pasta persistente do SQLite e rode `npm run build`.
5. Inicie com `pm2 start server/dist/server.js --name fechamento-caixa` e `pm2 save`.
6. Configure Nginx como proxy para `localhost:3000`.
7. Libere somente TCP 80 e 443 no firewall.
8. Rode `sudo certbot --nginx -d seu-dominio.com` para HTTPS.
9. Para atualizar: `git pull`, `npm ci --ignore-scripts`, `npm run build` e `pm2 restart fechamento-caixa`.
